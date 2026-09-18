// First-party execution tests for buyer return proposals (#25), extending the
// #22 execution suite's fake-client pattern with orders, refund/payment
// guards, and the policy-grounded revalidation path.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";
import { orderVersionProxy, RETURN_ACTION_KIND, RETURN_NEXT_STEPS } from "../services/assistantReturnProposals.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";

const REASON = "The left earcup arrived with a cracked hinge.";

const orderFixture = (overrides = {}) => {
  const updatedAt = new Date("2026-09-15T09:30:00Z");
  return {
    id: "order-1",
    userId: BUYER,
    orderNumber: "ORD-2026-0042",
    status: "Delivered",
    totalPrice: "1299.00",
    deliveredAt: new Date("2026-09-15T12:00:00Z"),
    returnRequestedAt: null,
    returnReason: null,
    updatedAt,
    ...overrides,
  };
};

const createProposalRow = (overrides = {}) => {
  const updatedAt = overrides.orderUpdatedAt ?? new Date("2026-09-15T09:30:00Z");
  return ({
    id: "prop-1",
    subjectId: BUYER,
    role: "user",
    clientId: "shopsphere-mcp-client",
    grantId: "grant-1",
    actionKind: RETURN_ACTION_KIND,
    targetType: "order",
    targetId: "order-1",
    canonicalPayload: { orderId: "order-1", reason: REASON },
    preview: {
      actionKind: RETURN_ACTION_KIND,
      orderId: "order-1",
      orderNumber: "ORD-2026-0042",
      currentStatus: "Delivered",
      returnEligible: true,
      orderTotal: { amount: "1299", currency: "NPR" },
      policyBasis: [{ sourceId: "faqs.json#1", sourceVersion: "1.0.0" }],
      disclosedConsequences: [
        "Creates a return request for seller/admin review",
        "Evidence photos are uploaded in ShopSphere, not here",
        "No refund is released by this action",
      ],
    },
    expectedVersion: Math.floor(updatedAt.getTime() / 1000),
    payloadHash: "b".repeat(64),
    status: "pending",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    executedAt: null,
    executionReference: null,
    createdAt: new Date(Date.now() - 60 * 1000),
    updatedAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  });
};

const createState = () => ({
  users: new Map([[BUYER, { id: BUYER, role: "user", email: "buyer@example.com" }]]),
  orders: new Map([["order-1", orderFixture()]]),
  proposals: new Map(),
  outbox: [],
  orderMutations: 0,
  refundMutations: 0,
  paymentMutations: 0,
});

const seedProposal = (state, overrides = {}) => {
  const row = createProposalRow(overrides);
  state.proposals.set(row.id, row);
  return row;
};

// In-memory prisma stand-in with the same serializing $transaction as the #22
// suite: concurrent confirmations observe the identical ordering they would
// against Postgres (loser re-evaluates status after the winner commits).
const createFakeClient = (state) => {
  const tx = {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
    },
    order: {
      findFirst: async ({ where }) => {
        for (const order of state.orders.values()) {
          if (where.id && order.id !== where.id) continue;
          if (where.userId && order.userId !== where.userId) continue;
          return order;
        }
        return null;
      },
      update: async ({ where, data }) => {
        const order = state.orders.get(where.id);
        if (!order) throw new Error("order not found");
        Object.assign(order, data);
        if (data.returnRequestedAt !== undefined || data.returnReason !== undefined || data.status !== undefined) {
          state.orderMutations += 1;
        }
        return order;
      },
      // Refund/payment surfaces exist only to prove the execution path never
      // touches them: any call is recorded and fails the assertions.
      updateMany: async ({ }) => { state.refundMutations += 1; return { count: 0 }; },
    },
    refund: {
      create: async () => { state.refundMutations += 1; return {}; },
      update: async () => { state.refundMutations += 1; return {}; },
      findFirst: async () => null,
    },
    payment: {
      update: async () => { state.paymentMutations += 1; return {}; },
      findFirst: async () => null,
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

test("review exposes the stored reason and the fixed return disclosures to the owner only", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const owned = await fetch(`${baseUrl(server)}/prop-1`);
  assert.equal(owned.status, 200);
  const body = await owned.json();
  assert.equal(body.proposal.actionKind, RETURN_ACTION_KIND);
  assert.equal(body.proposal.reason, REASON);
  assert.ok(body.proposal.disclosures.includes("Creates a return request for seller/admin review"));
  assert.ok(body.proposal.disclosures.includes("Evidence photos are uploaded in ShopSphere, not here"));
  assert.ok(body.proposal.disclosures.includes("No refund is released by this action"));
  assert.equal(body.proposal.preview.currentStatus, "Delivered");

  const foreignServer = await listen(client, { userId: RIVAL });
  t.after(() => close(foreignServer));
  const foreignResponse = await fetch(`${baseUrl(foreignServer)}/prop-1`);
  assert.equal(foreignResponse.status, 404);
  const missing = await fetch(`${baseUrl(server)}/prop-missing`);
  assert.equal(missing.status, 404);
  // Foreign and missing are the identical generic 404 body.
  assert.deepEqual(await missing.json(), await foreignResponse.json());
});

test("execute applies exactly the stored return request once, with nextSteps and no refund path", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "executed");
  assert.equal(body.executionReference, "proposal-exec-prop-1");
  assert.deepEqual(body.nextSteps, [...RETURN_NEXT_STEPS]);
  assert.ok(!("cartVersion" in body));

  const order = client.state.orders.get("order-1");
  assert.equal(order.status, "Return Requested");
  assert.ok(order.returnRequestedAt);
  assert.equal(order.returnReason, REASON);
  assert.equal(order.returnImage, undefined); // evidence never rides the proposal
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.refundMutations, 0);
  assert.equal(client.state.paymentMutations, 0);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.proposals.get("prop-1").status, "executed");

  // Retry after success replays the identical deterministic outcome with no
  // further mutation.
  const retry = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("concurrent confirmations produce exactly one mutation, one outbox outcome, and identical responses", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const call = () => fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const [first, second] = await Promise.all([call(), call()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  assert.deepEqual(await second.json(), firstBody);

  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.proposals.get("prop-1").status, "executed");
  assert.equal(client.state.orders.get("order-1").status, "Return Requested");
});

test("expired proposals are marked expired and never mutate the order", async (t) => {
  const client = createFakeClient(createState());
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
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.refundMutations, 0);
});

test("stale proposals (order updated after the preview) are marked stale with no mutation", async (t) => {
  const client = createFakeClient(createState());
  const proposal = seedProposal(client.state);
  // Concurrent storefront mutation after the proposal was created: updatedAt
  // moved (epoch seconds) while the business state stayed returnable.
  const order = client.state.orders.get("order-1");
  order.updatedAt = new Date(order.updatedAt.getTime() + 5000);
  assert.notEqual(orderVersionProxy(order), proposal.expectedVersion);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.proposals.get("prop-1").status, "stale");
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(order.status, "Delivered"); // the concurrent state stands; the proposal added nothing
});

test("business revalidation rejects a moved-on order without mutating it", async (t) => {
  for (const overrides of [
    { status: "Return Requested", returnRequestedAt: new Date("2026-09-16T08:00:00Z") }, // storefront return already started
    { status: "Shipped" }, // no longer delivered
  ]) {
    const client = createFakeClient(createState());
    client.state.orders.set("order-1", orderFixture(overrides));
    seedProposal(client.state, { expectedVersion: Math.floor(client.state.orders.get("order-1").updatedAt.getTime() / 1000) });
    const server = await listen(client);
    try {
      const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, "rejected");
      assert.equal(client.state.proposals.get("prop-1").status, "rejected");
      assert.equal(client.state.outbox[0].eventType, "rejected");
      assert.equal(client.state.orderMutations, 0);
    } finally {
      await close(server);
    }
  }
});

test("execution ignores the request body and applies only the stored canonical payload", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "forged reason", returnImage: "evil.png", refund: true, confirm: true }),
  });
  assert.equal(response.status, 200);
  const order = client.state.orders.get("order-1");
  assert.equal(order.returnReason, REASON); // the stored reason, nothing substituted
  assert.equal(order.returnImage, undefined);
  assert.equal(client.state.refundMutations, 0);
});

test("a role change after proposal time rejects execution", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  client.state.users.set(BUYER, { id: BUYER, role: "seller", email: "buyer@example.com" });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.orderMutations, 0);
});

test("foreign execution is the identical 404 with no mutation", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST" });
  assert.equal(response.status, 404);
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.refundMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-1").status, "pending");
  assert.equal(client.state.orders.get("order-1").status, "Delivered");
});

test("delegated MCP tokens are rejected on review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedProposal(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const headers = { authorization: `Bearer ${delegatedShapeToken}` };
  const review = await fetch(`${baseUrl(server)}/prop-1`, { headers });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const execute = await fetch(`${baseUrl(server)}/prop-1/execute`, { method: "POST", headers, body: "{}" });
  assert.equal(execute.status, 403);
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.refundMutations, 0);
});
