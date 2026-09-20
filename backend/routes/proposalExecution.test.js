import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const now = () => new Date();

const productFixture = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  price: "100.00",
  quantity: 5,
  isArchived: false,
  options: [{ kind: "color", value: "Black", priceDelta: "5.00" }],
  ...overrides,
});

const createProposalRow = (overrides = {}) => ({
  id: "prop-1",
  subjectId: BUYER,
  role: "user",
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  actionKind: "cart.update_quantity",
  targetType: "cart_item",
  targetId: "item-1",
  canonicalPayload: { action: "update_quantity", cartItemId: "item-1", quantity: 5 },
  preview: {
    actionKind: "cart.update_quantity",
    currency: "NPR",
    productName: "Headphones",
    availability: "In stock",
    before: { quantity: 2, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "180", currency: "NPR" }, cartSubtotal: { amount: "180", currency: "NPR" } },
    after: { quantity: 5, unitPrice: { amount: "90", currency: "NPR" }, lineTotal: { amount: "450", currency: "NPR" }, cartSubtotal: { amount: "450", currency: "NPR" } },
  },
  expectedVersion: 0,
  payloadHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const cartItemFixture = (overrides = {}) => ({
  id: "item-1",
  cartId: "cart-1",
  productId: "prod-1",
  quantity: 2,
  price: 100,
  variants: {},
  ...overrides,
});

const createState = () => ({
  users: new Map([[BUYER, { id: BUYER, role: "user", email: "buyer@example.com" }]]),
  products: new Map([["prod-1", productFixture()]]),
  carts: new Map(),
  proposals: new Map(),
  outbox: [],
  cartMutations: 0,
});

const seedCart = (state, { version = 0, items = [cartItemFixture()] } = {}) => {
  const cart = { id: "cart-1", userId: BUYER, email: "buyer@example.com", version, items };
  state.carts.set(cart.id, cart);
  return cart;
};

const seedProposal = (state, overrides = {}) => {
  const row = createProposalRow(overrides);
  state.proposals.set(row.id, row);
  return row;
};

// In-memory prisma stand-in. $transaction runs each transaction to completion
// on a serial chain — the same observable ordering concurrent confirmations see
// against Postgres, where the loser blocks on the claimed row and re-evaluates
// status after the winner commits.
const createFakeClient = (state) => {
  const bump = () => { state.cartMutations += 1; };
  const findCart = (id) => state.carts.get(id) ?? null;
  const withItems = (cart) => cart && { ...cart, items: cart.items };

  const tx = {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
    },
    product: {
      findUnique: async ({ where }) => state.products.get(where.id) ?? null,
    },
    cart: {
      findFirst: async ({ where }) => {
        for (const cart of state.carts.values()) {
          if (cart.userId === where.userId) return { id: cart.id, userId: cart.userId, email: cart.email, version: cart.version };
        }
        return null;
      },
      findUnique: async ({ where }) => withItems(findCart(where.id)),
      create: async ({ data }) => {
        const cart = {
          id: data.id,
          userId: data.userId,
          email: data.email,
          version: 0,
          items: (data.items?.create ?? []).map((item, index) => ({ id: `new-item-${index}`, cartId: data.id, ...item })),
        };
        state.carts.set(cart.id, cart);
        bump();
        return withItems(cart);
      },
      update: async ({ where, data }) => {
        const cart = findCart(where.id);
        if (!cart) throw new Error("cart not found");
        if (data.totalPrice !== undefined) cart.totalPrice = data.totalPrice;
        if (data.version?.increment) {
          cart.version += data.version.increment;
          bump();
        }
        return cart;
      },
    },
    cartItem: {
      findMany: async ({ where }) => {
        const cart = findCart(where.cartId);
        if (!cart) return [];
        return cart.items.filter((item) => (where.productId ? item.productId === where.productId : true));
      },
      findFirst: async ({ where }) => {
        const cart = findCart(where.cartId);
        if (!cart) return null;
        return cart.items.find((item) => item.id === where.id && item.cartId === where.cartId) ?? null;
      },
      update: async ({ where, data }) => {
        for (const cart of state.carts.values()) {
          const item = cart.items.find((candidate) => candidate.id === where.id);
          if (item) {
            if (data.quantity !== undefined) item.quantity = data.quantity;
            return item;
          }
        }
        throw new Error("cart item not found");
      },
      create: async ({ data }) => {
        const cart = findCart(data.cartId);
        const item = { id: `item-${state.outbox.length}-${Math.random().toString(16).slice(2)}`, cartId: data.cartId, ...data };
        cart.items.push(item);
        return item;
      },
      delete: async ({ where }) => {
        for (const cart of state.carts.values()) {
          const index = cart.items.findIndex((candidate) => candidate.id === where.id);
          if (index >= 0) return cart.items.splice(index, 1)[0];
        }
        throw new Error("cart item not found");
      },
    },
    proposal: {
      findUnique: async ({ where }) => state.proposals.get(where.id) ?? null,
      findFirst: async ({ where }) => {
        for (const proposal of state.proposals.values()) {
          if (where.id && proposal.id !== where.id) continue;
          if (where.subjectId && proposal.subjectId !== where.subjectId) continue;
          return proposal;
        }
        return null;
      },
      findMany: async ({ where, orderBy, take }) => {
        const rows = [...state.proposals.values()]
          .filter((proposal) => !where?.subjectId || proposal.subjectId === where.subjectId)
          .sort((a, b) => (orderBy?.createdAt === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
        return rows.slice(0, take ?? rows.length);
      },
      updateMany: async ({ where, data }) => {
        const proposal = state.proposals.get(where.id);
        if (!proposal) return { count: 0 };
        if (where.subjectId && proposal.subjectId !== where.subjectId) return { count: 0 };
        if (where.status && proposal.status !== where.status) return { count: 0 };
        Object.assign(proposal, data);
        return { count: 1 };
      },
    },
    proposalOutboxEvent: {
      create: async ({ data }) => {
        const row = { id: `outbox-${state.outbox.length}`, ...data };
        state.outbox.push(row);
        return row;
      },
    },
  };

  let chain = Promise.resolve();
  return {
    state,
    ...tx,
    $transaction: (fn) => {
      const run = chain.then(() => fn(tx));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
};

const listen = (client, { userId = BUYER, role = "user" } = {}) => {
  const authenticate = (req, _res, next) => {
    req.user = { id: userId, role };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1/proposals", createProposalExecutionRouter({ authenticate, client }));
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => server.once("listening", () => resolve(server)));
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

const baseUrl = (server) => `http://127.0.0.1:${server.address().port}/api/v1/proposals`;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const delegatedShapeToken = [
  b64url({ alg: "RS256", typ: "JWT" }),
  b64url({ iss: OAUTH_ISSUER, aud: ASSISTANT_AUDIENCE, sub: BUYER, sid: "grant-1", shopsphere_user_id: BUYER, shopsphere_role: "user", shopsphere_verified: true, exp: 9999999999 }),
  "not-a-real-signature",
].join(".");

test("review exposes the stored preview, version, expiry, and side-effect disclosures to the owner only", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state);
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const owned = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal(owned.status, 200);
  const body = await owned.json();
  assert.equal(body.proposal.id, "prop-1");
  assert.equal(body.proposal.actionKind, "cart.update_quantity");
  assert.equal(body.proposal.status, "pending");
  assert.equal(body.proposal.expectedVersion, 0);
  assert.deepEqual(body.proposal.preview.before.quantity, 2);
  assert.deepEqual(body.proposal.preview.after.quantity, 5);
  assert.deepEqual(body.proposal.preview.after.cartSubtotal, { amount: "450", currency: "NPR" });
  assert.ok(body.proposal.disclosures.includes("Changes your cart quantities"));
  assert.ok(body.proposal.disclosures.includes("No payment is taken"));
  assert.ok(!JSON.stringify(body).includes("executionReference"));

  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreignResponse = await fetch(`${baseUrl(foreignServer)}/prop-1`);
  assert.equal(foreignResponse.status, 404);
  const missing = await fetch(`${baseUrl(server)}/prop-missing`);
  assert.equal(missing.status, 404);
  // Foreign and missing are the identical generic 404 body.
  assert.deepEqual(await missing.json(), await foreignResponse.json());
});

test("execute applies the exact stored payload once, bumps the version, and writes one outbox event", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { status: "executed", executionReference: "proposal-exec-prop-1", cartVersion: 1 });

  const cart = client.state.carts.get("cart-1");
  assert.equal(cart.items.find((item) => item.id === "item-1").quantity, 5);
  assert.equal(cart.version, 1);
  assert.equal(client.state.cartMutations, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.outbox[0].proposalId, "prop-1");
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.ok(client.state.proposals.get("prop-1").executedAt);

  // Retry after success replays the identical deterministic outcome with no
  // further mutation.
  const retry = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.cartMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("concurrent confirmations produce exactly one mutation, one outbox outcome, and identical responses", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const call = () => fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const [first, second] = await Promise.all([call(), call()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(await second.json(), firstBody);

  assert.equal(client.state.cartMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.carts.get("cart-1").items.find((item) => item.id === "item-1").quantity, 5);
});

test("execution ignores the request body and applies only the stored canonical payload", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ canonicalPayload: { action: "remove_item", cartItemId: "item-1" }, productId: "prod-evil", quantity: 99, confirm: true }),
  });
  assert.equal(response.status, 200);
  const cart = client.state.carts.get("cart-1");
  // Stored update_quantity to 5 applied; the substituted remove/99/evil input changed nothing.
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 5);
  assert.equal(cart.items[0].productId, "prod-1");
});

test("expired proposals are marked expired and never mutate the cart", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state, { expiresAt: new Date(Date.now() - 1000) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "expired");
  assert.equal(client.state.proposals.get("prop-1").status, "expired");
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "expired");
  assert.equal(client.state.cartMutations, 0);

  const review = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal((await review.json()).proposal.status, "expired");
});

test("stale proposals (cart changed after preview) are marked stale with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state, { expectedVersion: 0 });
  client.state.carts.get("cart-1").version = 1; // concurrent storefront mutation after preview
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.cartMutations, 0);
  // The concurrent mutation stands; the proposal added nothing.
  assert.equal(client.state.carts.get("cart-1").items[0].quantity, 2);
});

test("business-rule revalidation rejects archived or sold-out targets without mutating the cart", async (t) => {
  for (const productOverrides of [{ isArchived: true }, { quantity: 0 }]) {
    const client = createFakeClient(createState());
    client.state.products.set("prod-1", productFixture(productOverrides));
    seedCart(client.state, { version: 0 });
    seedProposal(client.state, {
      actionKind: "cart.add_item",
      targetType: "cart",
      targetId: null,
      canonicalPayload: { action: "add_item", productId: "prod-1", quantity: 2 },
    });
    const server = await listen(client);
    try {
      const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, "rejected");
      assert.equal(client.state.proposals.get("prop-1").status, "rejected");
      assert.equal(client.state.outbox[0].eventType, "rejected");
      assert.equal(client.state.cartMutations, 0);
    } finally {
      await close(server);
    }
  }
});

test("a role change after proposal time rejects execution", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  client.state.users.set(BUYER, { id: BUYER, role: "seller", email: "buyer@example.com" });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.cartMutations, 0);
});

test("foreign execution is the identical 404 with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 404);
  assert.equal(client.state.cartMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
});

test("delegated MCP tokens are rejected on review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, { version: 0 });
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const headers = { authorization: `Bearer ${delegatedShapeToken}` };
  const review = await fetch(`${baseUrl(server)}/prop-1`, { headers });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const execute = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers, body: "{}" });
  assert.equal(execute.status, 403);
  assert.equal(client.state.cartMutations, 0);
});

test("add_item execution creates the cart when the buyer had none", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, {
    actionKind: "cart.add_item",
    targetType: "cart",
    targetId: null,
    canonicalPayload: { action: "add_item", productId: "prod-1", options: { color: "Black" }, quantity: 2 },
    expectedVersion: 0,
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cartVersion, 1);
  const cart = [...client.state.carts.values()][0];
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].productId, "prod-1");
  assert.equal(cart.items[0].quantity, 2);
  assert.equal(cart.version, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
});

test("the owner's proposal list is bounded to 20, newest first", async (t) => {
  const client = createFakeClient(createState());
  for (let index = 0; index < 25; index += 1) {
    seedProposal(client.state, { id: `prop-${index}`, createdAt: new Date(Date.now() - index * 1000) });
  }
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.proposals.length, 20);
  assert.equal(body.proposals[0].id, "prop-0");
  assert.equal(body.proposals[19].id, "prop-19");
  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreign = await fetch(`${baseUrl(foreignServer)}`);
  assert.deepEqual((await foreign.json()).proposals, []);
});

test("remove_item execution deletes exactly the stored line and keeps the rest", async (t) => {
  const client = createFakeClient(createState());
  seedCart(client.state, {
    version: 0,
    items: [cartItemFixture(), cartItemFixture({ id: "item-2", productId: "prod-2" })],
  });
  client.state.products.set("prod-2", productFixture({ id: "prod-2" }));
  seedProposal(client.state, {
    canonicalPayload: { action: "remove_item", cartItemId: "item-1" },
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 200);
  const cart = client.state.carts.get("cart-1");
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].id, "item-2");
  assert.equal(cart.version, 1);
  assert.equal(client.state.cartMutations, 1);
});
