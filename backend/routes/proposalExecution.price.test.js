// #27: first-party execution of product.set_price / product.set_discount
// proposals. Complements (never edits) proposalExecution.test.js and the
// #24/#25 branch files: stepped-up password re-confirmation, verification and
// ownership reauthorization, the product updatedAt epoch-seconds version proxy,
// exactly-once application, and the absolute absence of any
// notification/payment/order/promotion interaction.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { productVersionOf } from "../services/assistantPriceProposals.js";
import { hashPassword } from "../utils/password.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SELLER_PASSWORD = "S3ller-Passphrase!";
const PASSWORD_HASH = await hashPassword(SELLER_PASSWORD);
const PRODUCT_UPDATED_AT = new Date("2026-09-18T09:00:00.000Z");
const EXPECTED_VERSION = Math.floor(PRODUCT_UPDATED_AT.getTime() / 1000);

const productFixture = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  price: "900.00",
  discount: "10",
  quantity: 5,
  isArchived: false,
  sellerId: SELLER,
  updatedAt: PRODUCT_UPDATED_AT,
  ...overrides,
});

const previewFixture = {
  actionKind: "product.set_price",
  currency: "NPR",
  productId: "prod-1",
  productName: "Headphones",
  change: "set_price",
  oldValue: "900",
  newValue: "850",
  effectiveDisplayPriceBefore: { amount: "810", currency: "NPR" },
  effectiveDisplayPriceAfter: { amount: "765", currency: "NPR" },
  disclosedConsequences: [
    "Changes the live listing price from 900 to 850 NPR",
    "No orders, payments, or promotions are affected",
  ],
};

const createPriceProposalRow = (overrides = {}) => ({
  id: "prop-1",
  subjectId: SELLER,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  actionKind: "product.set_price",
  targetType: "product",
  targetId: "prod-1",
  canonicalPayload: { productId: "prod-1", change: "set_price", newValue: "850" },
  preview: previewFixture,
  expectedVersion: EXPECTED_VERSION,
  payloadHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const createState = () => ({
  users: new Map([
    [SELLER, { id: SELLER, role: "seller", email: "seller@example.com", isVerified: true, password: PASSWORD_HASH }],
  ]),
  products: new Map([["prod-1", productFixture()]]),
  proposals: new Map(),
  outbox: [],
  productMutations: 0,
  moneySurfaceAttempts: 0, // any notification/order/payment/refund/revenue/promo write attempt
  failNextProductClaim: false,
});

const seedProposal = (state, overrides = {}) => {
  const row = createPriceProposalRow(overrides);
  state.proposals.set(row.id, row);
  return row;
};

// In-memory prisma stand-in mirroring proposalExecution.cancel.test.js's serial
// $transaction chain with rollback semantics. Money/notification surfaces are
// hard guards: any attempt counts and throws, so a single call would fail the
// test twice over.
const createFakeClient = (state) => {
  const moneyGuard = (surface) => async () => {
    state.moneySurfaceAttempts += 1;
    throw new Error(`execution path must never touch ${surface}`);
  };

  const tx = {
    user: {
      findUnique: async ({ where }) => {
        const user = state.users.get(where.id);
        return user ? { ...user } : null;
      },
    },
    product: {
      findFirst: async ({ where }) => {
        const product = state.products.get(where.id) ?? null;
        if (!product) return null;
        if (where.sellerId && product.sellerId !== where.sellerId) return null;
        return { ...product };
      },
      // The one exact conditional update the price path may perform: guarded
      // on ownership AND the exact updatedAt the version proxy was derived
      // from (Prisma would also bump @updatedAt, which this simulates).
      updateMany: async ({ where, data }) => {
        const product = state.products.get(where.id);
        if (!product) return { count: 0 };
        if (where.sellerId && product.sellerId !== where.sellerId) return { count: 0 };
        if (where.updatedAt && product.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        if (state.failNextProductClaim) {
          state.failNextProductClaim = false;
          return { count: 0 };
        }
        if (data.price !== undefined) product.price = data.price;
        if (data.discount !== undefined) product.discount = data.discount;
        if (data.discountUpdatedAt !== undefined) product.discountUpdatedAt = data.discountUpdatedAt;
        product.updatedAt = new Date(PRODUCT_UPDATED_AT.getTime() + state.productMutations * 60_000 + 1000);
        state.productMutations += 1;
        return { count: 1 };
      },
      update: moneyGuard("product.update (use the conditional claim)"),
      create: moneyGuard("product.create"),
      delete: moneyGuard("product.delete"),
    },
    productOption: {
      update: moneyGuard("product options"),
      updateMany: moneyGuard("product options"),
      create: moneyGuard("product options"),
    },
    order: {
      update: moneyGuard("orders"),
      updateMany: moneyGuard("orders"),
      create: moneyGuard("orders"),
    },
    payment: {
      update: moneyGuard("payments"),
      updateMany: moneyGuard("payments"),
      create: moneyGuard("payments"),
      findFirst: moneyGuard("payments"),
    },
    refund: {
      findFirst: moneyGuard("refunds"),
      create: moneyGuard("refunds"),
      update: moneyGuard("refunds"),
    },
    revenue: {
      update: moneyGuard("revenue"),
      updateMany: moneyGuard("revenue"),
      create: moneyGuard("revenue"),
    },
    promoCode: {
      update: moneyGuard("promotions"),
      updateMany: moneyGuard("promotions"),
      create: moneyGuard("promotions"),
    },
    notification: {
      create: moneyGuard("notifications"),
      update: moneyGuard("notifications"),
      updateMany: moneyGuard("notifications"),
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
  // Transactional semantics: a thrown error rolls the tx back (proposal claim
  // included), mirroring the Postgres behavior the product_state_changed path
  // relies on. The one-shot fault flag models a transient lost race, not
  // durable state, so it lives outside the snapshot.
  const snapshot = () => ({
    users: new Map([...state.users].map(([k, v]) => [k, { ...v }])),
    products: new Map([...state.products].map(([k, v]) => [k, { ...v }])),
    proposals: new Map([...state.proposals].map(([k, v]) => [k, { ...v }])),
    outbox: [...state.outbox],
    productMutations: state.productMutations,
    moneySurfaceAttempts: state.moneySurfaceAttempts,
  });
  const restore = (snap) => {
    state.users = snap.users;
    state.products = snap.products;
    state.proposals = snap.proposals;
    state.outbox = snap.outbox;
    state.productMutations = snap.productMutations;
    state.moneySurfaceAttempts = snap.moneySurfaceAttempts;
  };
  return {
    state,
    ...tx,
    $transaction: (fn) => {
      const run = chain.then(async () => {
        const before = snapshot();
        try {
          return await fn(tx);
        } catch (error) {
          restore(before);
          throw error;
        }
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
};

const listen = (client, { userId = SELLER, role = "seller" } = {}) => {
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

const execute = (server, body) =>
  fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const delegatedShapeToken = [
  b64url({ alg: "RS256", typ: "JWT" }),
  b64url({ iss: OAUTH_ISSUER, aud: ASSISTANT_AUDIENCE, sub: SELLER, sid: "grant-1", shopsphere_user_id: SELLER, shopsphere_role: "seller", shopsphere_verified: true, exp: 9999999999 }),
  "not-a-real-signature",
].join(".");
const delegatedHeaders = { authorization: `Bearer ${delegatedShapeToken}`, "content-type": "application/json" };

test("review exposes the exact stored price preview; foreign and missing are the identical 404", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const owned = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal(owned.status, 200);
  const body = await owned.json();
  assert.equal(body.proposal.actionKind, "product.set_price");
  assert.equal(body.proposal.status, "pending");
  assert.equal(body.proposal.expectedVersion, EXPECTED_VERSION);
  assert.equal(body.proposal.preview.oldValue, "900");
  assert.equal(body.proposal.preview.newValue, "850");
  assert.deepEqual(body.proposal.preview.effectiveDisplayPriceAfter, { amount: "765", currency: "NPR" });
  assert.deepEqual(body.proposal.disclosures, body.proposal.preview.disclosedConsequences);
  assert.ok(body.proposal.disclosures.includes("No orders, payments, or promotions are affected"));
  assert.ok(!JSON.stringify(body).includes("executionReference"));

  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreignResponse = await fetch(`${baseUrl(foreignServer)}/prop-1`);
  assert.equal(foreignResponse.status, 404);
  const missing = await fetch(`${baseUrl(server)}/prop-missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), await foreignResponse.json());
});

test("executing with the correct password applies the price exactly once and never touches other surfaces", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "executed",
    executionReference: "proposal-exec-prop-1",
    productId: "prod-1",
    appliedChange: { change: "set_price", newValue: "850" },
  });

  const product = client.state.products.get("prod-1");
  assert.equal(product.price, "850");
  assert.equal(product.discount, "10"); // untouched
  assert.equal(product.discountUpdatedAt, undefined); // not stamped for set_price
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.moneySurfaceAttempts, 0); // no notification/order/payment/refund/promo write
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.proposals.get("prop-1").status, "executed");

  // Retry after success replays the identical deterministic outcome with no
  // further mutation — and the replay path needs no password (the proposal is
  // no longer pending, so the step-up branch never runs).
  const retry = await execute(server, {});
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("executing a set_discount proposal stamps discountUpdatedAt and leaves the price alone", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, {
    actionKind: "product.set_discount",
    canonicalPayload: { productId: "prod-1", change: "set_discount", newValue: "25" },
    preview: {
      ...previewFixture,
      actionKind: "product.set_discount",
      change: "set_discount",
      oldValue: "10",
      newValue: "25",
      disclosedConsequences: [
        "Changes the discount percentage from 10% to 25%",
        "No orders, payments, or promotions are affected",
      ],
    },
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).appliedChange, { change: "set_discount", newValue: "25" });

  const product = client.state.products.get("prod-1");
  assert.equal(product.price, "900.00"); // untouched
  assert.equal(product.discount, "25");
  assert.ok(product.discountUpdatedAt instanceof Date);
  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.moneySurfaceAttempts, 0);
});

test("missing confirmPassword answers 403 reauthorization_required with NO state change", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, {});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "reauthorization_required");
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.products.get("prod-1").price, "900.00");
  assert.equal(client.state.moneySurfaceAttempts, 0);

  // A correct password afterwards still executes exactly once.
  const good = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(good.status, 200);
  assert.equal(client.state.productMutations, 1);
});

test("a wrong confirmPassword answers 403 and an account without a password can never step up", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const wrong = await execute(server, { confirmPassword: "Not-My-Password" });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).code, "reauthorization_required");

  // OAuth-only account: no password hash exists, so step-up is impossible.
  client.state.users.get(SELLER).password = null;
  const oauthOnly = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(oauthOnly.status, 403);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.outbox.length, 0);
});

test("a seller whose verification was revoked answers 403 verification_required with NO state change", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  client.state.users.get(SELLER).isVerified = false;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "verification_required");
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.products.get("prod-1").price, "900.00");
});

test("a committed product change after the preview marks the proposal stale with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  // Concurrent storefront mutation after the proposal was created: any row
  // change moves updatedAt, which moves the version proxy.
  client.state.products.get("prod-1").updatedAt = new Date(PRODUCT_UPDATED_AT.getTime() + 4000);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.products.get("prod-1").price, "900.00");
});

test("a same-second collision (version matches, current value now violates the bounds) is rejected", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, {
    // The proposal asks for 850 while the live price is ALREADY 850 — the
    // sub-second race the epoch-seconds proxy cannot see; the fresh bounds
    // re-check must refuse.
    canonicalPayload: { productId: "prod-1", change: "set_price", newValue: "850" },
  });
  client.state.products.get("prod-1").price = "850";
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.proposals.get("prop-1").status, "rejected");
  assert.equal(client.state.outbox[0].eventType, "rejected");
  assert.equal(client.state.productMutations, 0);
});

test("a product that no longer belongs to this seller is rejected, never applied", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  client.state.products.get("prod-1").sellerId = RIVAL;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.proposals.get("prop-1").status, "rejected");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.outbox[0].eventType, "rejected");
});

test("concurrent confirmations apply the price exactly once and replay the identical response", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);

  const call = () => execute(server, { confirmPassword: SELLER_PASSWORD });
  const [first, second] = await Promise.all([call(), call()]);
  t.after(() => close(server));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(await second.json(), firstBody);

  assert.equal(client.state.productMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.products.get("prod-1").price, "850");
});

test("a lost conditional product claim rolls everything back and keeps the proposal pending", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  // Simulates a concurrent storefront price write winning between the fresh
  // read and the conditional claim inside the execution transaction.
  client.state.failNextProductClaim = true;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "product_state_changed");
  // Nothing happened: the proposal claim rolled back with the transaction.
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.products.get("prod-1").price, "900.00");
  assert.equal(client.state.outbox.length, 0);

  // A retry resolves deterministically against the current state.
  const retry = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(retry.status, 200);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.products.get("prod-1").price, "850");
});

test("foreign execution is the identical 404 with no mutation and no outbox event", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 404);
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.products.get("prod-1").price, "900.00");
});

test("delegated MCP tokens are rejected on price review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const review = await fetch(`${baseUrl(server)}/prop-1`, { headers: delegatedHeaders });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const executeResponse = await fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: delegatedHeaders,
    body: JSON.stringify({ confirmPassword: SELLER_PASSWORD }),
  });
  assert.equal(executeResponse.status, 403);
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.moneySurfaceAttempts, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
});

test("expired proposals are marked expired and never mutate the product", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state, { expiresAt: new Date(Date.now() - 1000) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await execute(server, { confirmPassword: SELLER_PASSWORD });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "expired");
  assert.equal(client.state.proposals.get("prop-1").status, "expired");
  assert.equal(client.state.outbox[0].eventType, "expired");
  assert.equal(client.state.productMutations, 0);
  assert.equal(client.state.products.get("prod-1").price, "900.00");
});

test("the version proxy stays consistent between propose-side math and execution", () => {
  // productVersionOf is the single derivation both sides use.
  assert.equal(productVersionOf({ updatedAt: PRODUCT_UPDATED_AT }), EXPECTED_VERSION);
  assert.equal(productVersionOf({ updatedAt: PRODUCT_UPDATED_AT.toISOString() }), EXPECTED_VERSION);
});
