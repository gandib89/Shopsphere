// #24: first-party execution of order.cancel proposals. Complements (never
// edits) proposalExecution.test.js with the order.cancel branch: exactly-once
// cancellation, staleness, stock restore semantics, and the absolute absence
// of any refund/payment interaction.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { orderVersionOf } from "../services/assistantCancellationProposals.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ORDER_UPDATED_AT = new Date("2026-09-18T09:00:00.000Z");
const EXPECTED_VERSION = Math.floor(ORDER_UPDATED_AT.getTime() / 1000);

const productFixture = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  price: "900.00",
  quantity: 5,
  isArchived: false,
  ...overrides,
});

const orderFixture = (overrides = {}) => ({
  id: "order-1",
  userId: BUYER,
  orderNumber: "ORD-2026-0001",
  status: "Confirmed",
  quantity: 2,
  productId: "prod-1",
  variantColor: null,
  variantStorage: null,
  updatedAt: ORDER_UPDATED_AT,
  ...overrides,
});

const createCancelProposalRow = (overrides = {}) => ({
  id: "prop-1",
  subjectId: BUYER,
  role: "user",
  clientId: "shopsphere-mcp-client",
  grantId: "grant-1",
  actionKind: "order.cancel",
  targetType: "order",
  targetId: "order-1",
  canonicalPayload: { orderId: "order-1" },
  preview: {
    actionKind: "order.cancel",
    currency: "NPR",
    orderId: "order-1",
    orderNumber: "ORD-2026-0001",
    currentStatus: "Confirmed",
    cancelEligible: true,
    stockToRestore: 2,
    paidAmount: { amount: "1890.50", currency: "NPR" },
    disclosedConsequences: [
      "Cancels the order",
      "Restores 2 item(s) to stock",
      "Any refund is a separate manual admin action and is NOT initiated here",
    ],
  },
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
  users: new Map([[BUYER, { id: BUYER, role: "user", email: "buyer@example.com" }]]),
  products: new Map([["prod-1", productFixture()]]),
  orders: new Map(),
  proposals: new Map(),
  outbox: [],
  orderMutations: 0,
  stockIncrements: 0,
  moneySurfaceAttempts: 0, // any payment/refund/revenue/notification write attempt
  failNextOrderClaim: false,
});

const seedOrder = (state, overrides = {}) => {
  const row = orderFixture(overrides);
  state.orders.set(row.id, row);
  return row;
};

const seedProposal = (state, overrides = {}) => {
  const row = createCancelProposalRow(overrides);
  state.proposals.set(row.id, row);
  return row;
};

// In-memory prisma stand-in mirroring proposalExecution.test.js's serial
// $transaction chain. Money surfaces (payments/refunds/revenue/notifications)
// are hard guards: any attempt counts and throws, so a single call would fail
// the test twice over.
const createFakeClient = (state) => {
  const moneyGuard = (surface) => async () => {
    state.moneySurfaceAttempts += 1;
    throw new Error(`execution path must never touch ${surface}`);
  };

  const tx = {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
    },
    order: {
      findFirst: async ({ where }) => {
        const order = state.orders.get(where.id) ?? null;
        if (!order) return null;
        if (where.userId && order.userId !== where.userId) return null;
        return { ...order };
      },
      findUnique: async ({ where }) => state.orders.get(where.id) ?? null,
      updateMany: async ({ where, data }) => {
        const order = state.orders.get(where.id);
        if (!order) return { count: 0 };
        if (where.userId && order.userId !== where.userId) return { count: 0 };
        if (where.status && order.status !== where.status) return { count: 0 };
        if (state.failNextOrderClaim) {
          state.failNextOrderClaim = false;
          return { count: 0 };
        }
        Object.assign(order, data);
        state.orderMutations += 1;
        return { count: 1 };
      },
      update: moneyGuard("order.update (use the conditional claim)"),
      create: moneyGuard("order.create"),
      delete: moneyGuard("order.delete"),
    },
    product: {
      findUnique: async ({ where }) => {
        const product = state.products.get(where.id);
        return product ? { ...product, colorVariants: [], storageVariants: [] } : null;
      },
      update: async ({ where, data }) => {
        const product = state.products.get(where.id);
        if (!product) throw new Error("product not found");
        if (data.quantity?.increment) {
          product.quantity += data.quantity.increment;
          state.stockIncrements += 1;
        }
        return product;
      },
    },
    productColorVariant: { updateMany: async () => ({ count: 0 }) },
    productStorageVariant: { updateMany: async () => ({ count: 0 }) },
    payment: {
      update: moneyGuard("payments"),
      updateMany: moneyGuard("payments"),
      create: moneyGuard("payments"),
      findFirst: moneyGuard("payments"),
      findMany: moneyGuard("payments"),
    },
    refund: {
      findFirst: moneyGuard("refunds"),
      findMany: moneyGuard("refunds"),
      create: moneyGuard("refunds"),
      update: moneyGuard("refunds"),
      updateMany: moneyGuard("refunds"),
    },
    revenue: {
      update: moneyGuard("revenue"),
      updateMany: moneyGuard("revenue"),
      create: moneyGuard("revenue"),
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
  // Transactional semantics: a thrown error rolls the tx back, mirroring the
  // Postgres behavior the order_state_changed path relies on. The one-shot
  // fault flag is deliberately outside the snapshot (it models a transient
  // lost race, not durable state).
  const snapshot = () => ({
    users: new Map([...state.users].map(([k, v]) => [k, { ...v }])),
    products: new Map([...state.products].map(([k, v]) => [k, { ...v }])),
    orders: new Map([...state.orders].map(([k, v]) => [k, { ...v }])),
    proposals: new Map([...state.proposals].map(([k, v]) => [k, { ...v }])),
    outbox: [...state.outbox],
    orderMutations: state.orderMutations,
    stockIncrements: state.stockIncrements,
    moneySurfaceAttempts: state.moneySurfaceAttempts,
  });
  const restore = (snap) => {
    state.users = snap.users;
    state.products = snap.products;
    state.orders = snap.orders;
    state.proposals = snap.proposals;
    state.outbox = snap.outbox;
    state.orderMutations = snap.orderMutations;
    state.stockIncrements = snap.stockIncrements;
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

test("review exposes the exact stored preview and its disclosures match disclosedConsequences exactly", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const owned = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal(owned.status, 200);
  const body = await owned.json();
  assert.equal(body.proposal.actionKind, "order.cancel");
  assert.equal(body.proposal.status, "pending");
  assert.equal(body.proposal.expectedVersion, EXPECTED_VERSION);
  assert.deepEqual(body.proposal.preview.stockToRestore, 2);
  assert.deepEqual(body.proposal.preview.paidAmount, { amount: "1890.50", currency: "NPR" });
  // The review disclosure list IS the stored preview's disclosedConsequences.
  assert.deepEqual(body.proposal.disclosures, body.proposal.preview.disclosedConsequences);
  assert.ok(body.proposal.disclosures.includes("Any refund is a separate manual admin action and is NOT initiated here"));
  assert.ok(!JSON.stringify(body).includes("executionReference"));

  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreignResponse = await fetch(`${baseUrl(foreignServer)}/prop-1`);
  assert.equal(foreignResponse.status, 404);
  const missing = await fetch(`${baseUrl(server)}/prop-missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), await foreignResponse.json());
});

test("executing a Confirmed order cancels exactly once, restores stock exactly once, and never touches money", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state, { status: "Confirmed", quantity: 2 });
  seedProposal(client.state, { expectedVersion: EXPECTED_VERSION });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "executed",
    executionReference: "proposal-exec-prop-1",
    orderId: "order-1",
    orderStatus: "Cancelled",
  });

  const order = client.state.orders.get("order-1");
  assert.equal(order.status, "Cancelled");
  assert.ok(order.cancelledAt);
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.stockIncrements, 1); // stock restored exactly once
  assert.equal(client.state.products.get("prod-1").quantity, 7);
  assert.equal(client.state.moneySurfaceAttempts, 0); // no payment/refund/revenue/notification write
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.proposals.get("prop-1").status, "executed");

  // Retry after success replays the identical deterministic outcome with no
  // further mutation or stock change.
  const retry = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.stockIncrements, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("executing a Pending order cancels without any stock restore", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state, { status: "Pending", quantity: 3, updatedAt: ORDER_UPDATED_AT });
  seedProposal(client.state, {
    expectedVersion: EXPECTED_VERSION,
    preview: {
      actionKind: "order.cancel",
      currency: "NPR",
      orderId: "order-1",
      orderNumber: "ORD-2026-0001",
      currentStatus: "Pending",
      cancelEligible: true,
      stockToRestore: 0,
      paidAmount: null,
      disclosedConsequences: [
        "Cancels the order",
        "Restores 0 item(s) to stock",
        "Any refund is a separate manual admin action and is NOT initiated here",
      ],
    },
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "executed",
    executionReference: "proposal-exec-prop-1",
    orderId: "order-1",
    orderStatus: "Cancelled",
  });
  assert.equal(client.state.orders.get("order-1").status, "Cancelled");
  assert.equal(client.state.stockIncrements, 0); // Pending never had stock deducted
  assert.equal(client.state.moneySurfaceAttempts, 0);
});

test("concurrent confirmations cancel exactly once and replay the identical response", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const call = () => fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  const [first, second] = await Promise.all([call(), call()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(await second.json(), firstBody);

  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.stockIncrements, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.orders.get("order-1").status, "Cancelled");
});

test("a committed order change after the preview marks the proposal stale with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  // Concurrent storefront mutation after the proposal was created: any row
  // change moves updatedAt, which moves the version proxy.
  client.state.orders.get("order-1").updatedAt = new Date(ORDER_UPDATED_AT.getTime() + 4000);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.stockIncrements, 0);
  // The concurrent mutation stands; the proposal added nothing.
  assert.equal(client.state.orders.get("order-1").status, "Confirmed");
});

test("an order that became ineligible (same-second version collision) is rejected, not cancelled", async (t) => {
  const client = createFakeClient(createState());
  // Simulates the sub-second race the epoch-second proxy cannot see: the row
  // changed inside the same wall-clock second as the preview, so the version
  // matches but the fresh eligibility check must still refuse.
  seedOrder(client.state, { status: "Shipped", updatedAt: ORDER_UPDATED_AT });
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.proposals.get("prop-1").status, "rejected");
  assert.equal(client.state.outbox[0].eventType, "rejected");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.stockIncrements, 0);
  assert.equal(client.state.orders.get("order-1").status, "Shipped");
});

test("expired proposals are marked expired and never mutate the order", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state, { expiresAt: new Date(Date.now() - 1000) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proposal_not_executable");
  assert.equal(body.reason, "expired");
  assert.equal(client.state.proposals.get("prop-1").status, "expired");
  assert.equal(client.state.outbox[0].eventType, "expired");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.stockIncrements, 0);
  assert.equal(client.state.orders.get("order-1").status, "Confirmed");
});

test("foreign execution is the identical 404 with no mutation and no outbox event", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 404);
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.stockIncrements, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.orders.get("order-1").status, "Confirmed");
});

test("a lost conditional order claim rolls everything back and keeps the proposal pending", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  // Simulates a concurrent storefront cancellation winning between the fresh
  // read and the conditional claim inside the execution transaction.
  client.state.failNextOrderClaim = true;
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "order_state_changed");
  // Nothing happened: the proposal claim rolled back with the transaction.
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.orders.get("order-1").status, "Confirmed");
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.stockIncrements, 0);

  // A retry resolves deterministically against the current state.
  const retry = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.orders.get("order-1").status, "Cancelled");
});

test("delegated MCP tokens are rejected on cancellation review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedOrder(client.state);
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const headers = { authorization: `Bearer ${delegatedShapeToken}` };
  const review = await fetch(`${baseUrl(server)}/prop-1`, { headers });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const execute = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers });
  assert.equal(execute.status, 403);
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.moneySurfaceAttempts, 0);
});

test("the version proxy stays consistent between propose-side math and execution", () => {
  // orderVersionOf is the single derivation both sides use.
  assert.equal(orderVersionOf({ updatedAt: ORDER_UPDATED_AT }), EXPECTED_VERSION);
  assert.equal(orderVersionOf({ updatedAt: ORDER_UPDATED_AT.toISOString() }), EXPECTED_VERSION);
});
