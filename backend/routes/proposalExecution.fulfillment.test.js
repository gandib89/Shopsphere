// First-party execution tests for the #29 fulfillment proposal branch:
// cross-seller 404, unverified-seller 403 with no transition, staleness on
// order change, exactly-once, CAS conflict rollback, pending-payment
// (Pending status) rejection at propose AND execution, no email/notification
// writes (throwing guards), delegated-token rejection, and deterministic
// replay. Mirrors the in-memory harness of proposalExecution.listing.test.js
// with the order CAS in place of the product CAS.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createProposalExecutionRouter } from "./proposalExecutionRoute.js";
import { ASSISTANT_AUDIENCE, OAUTH_ISSUER } from "../utils/mcpOAuth.js";
import { proposeFulfillmentTransition } from "../services/assistantFulfillmentProposals.js";
import { orderVersionOf } from "../services/assistantCancellationProposals.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const SALE_LINE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2";

const saleLineRow = (overrides = {}) => ({
  id: SALE_LINE_ID,
  orderNumber: "ORD-2026-0042",
  status: "Confirmed",
  sellerIdAtPurchase: SELLER, // the immutable attribution the predicate scopes on
  confirmedAt: new Date("2026-09-19T08:00:00Z"),
  processingAt: null,
  shippedAt: null,
  deliveredAt: null,
  updatedAt: new Date("2026-09-19T09:00:00.000Z"),
  ...overrides,
});

const fulfillmentProposalRow = (overrides = {}) => ({
  id: "prop-fulfill-1",
  subjectId: SELLER,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId: GRANT,
  actionKind: "sale.advance_fulfillment",
  targetType: "order",
  targetId: SALE_LINE_ID,
  canonicalPayload: { saleLineId: SALE_LINE_ID, nextStatus: "Processing" },
  preview: { actionKind: "sale.advance_fulfillment" },
  expectedVersion: orderVersionOf(saleLineRow()),
  payloadHash: "c".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  executedAt: null,
  executionReference: null,
  createdAt: new Date(Date.now() - 60 * 1000),
  updatedAt: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const createState = ({ verified = true } = {}) => ({
  users: new Map([[SELLER, { id: SELLER, role: "seller", email: "seller@example.com", isVerified: verified }]]),
  orders: new Map([[SALE_LINE_ID, saleLineRow()]]),
  proposals: new Map(),
  outbox: [],
  orderMutations: 0,
});

const seedFulfillment = (state, { proposal, order } = {}) => {
  state.proposals.set(proposal?.id ?? "prop-fulfill-1", proposal ?? fulfillmentProposalRow());
  state.orders.set(SALE_LINE_ID, order ?? saleLineRow());
};

const createFakeClient = (state, { casFails = false } = {}) => {
  const forbidden = (table, method) => async () => {
    throw new Error(`forbidden write during execution: ${table}.${method}`);
  };
  const tx = {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
      findMany: forbidden("user", "findMany"),
    },
    // The execution path sends NO buyer notification/email (the disclosure
    // says exactly that): any notification write fails the test loudly.
    notification: {
      create: forbidden("notification", "create"),
      createMany: forbidden("notification", "createMany"),
      update: forbidden("notification", "update"),
      updateMany: forbidden("notification", "updateMany"),
    },
    payment: {
      update: forbidden("payment", "update"),
      updateMany: forbidden("payment", "updateMany"),
    },
    refund: {
      create: forbidden("refund", "create"),
    },
    revenue: {
      update: forbidden("revenue", "update"),
      updateMany: forbidden("revenue", "updateMany"),
    },
    order: {
      // The attribution predicate: only the acting seller's own
      // sellerIdAtPurchase rows resolve (NULL attribution matches nothing).
      findFirst: async ({ where }) => {
        const order = state.orders.get(where.id) ?? null;
        if (!order) return null;
        if (where.sellerIdAtPurchase !== undefined && order.sellerIdAtPurchase !== where.sellerIdAtPurchase) {
          return null;
        }
        return order;
      },
      // Only the single conditional compare-and-swap may exist. A plain
      // update, create, or delete on the order is always a bug.
      update: forbidden("order", "update"),
      create: forbidden("order", "create"),
      delete: forbidden("order", "delete"),
      updateMany: async ({ where, data }) => {
        const order = state.orders.get(where.id);
        if (!order) return { count: 0 };
        if (where.sellerIdAtPurchase !== undefined && order.sellerIdAtPurchase !== where.sellerIdAtPurchase) {
          return { count: 0 };
        }
        if (where.status !== undefined && order.status !== where.status) return { count: 0 };
        if (where.updatedAt && order.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        if (casFails) return { count: 0 };
        Object.assign(order, data);
        // Prisma's @updatedAt: any mutation bumps the version proxy.
        order.updatedAt = new Date(order.updatedAt.getTime() + 1000);
        state.orderMutations += 1;
        return { count: 1 };
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
    orders: new Map([...state.orders].map(([k, v]) => [k, { ...v }])),
    proposals: new Map([...state.proposals].map(([k, v]) => [k, { ...v }])),
    outbox: [...state.outbox],
    orderMutations: state.orderMutations,
  });
  const restore = (snap) => {
    state.users = snap.users;
    state.orders = snap.orders;
    state.proposals = snap.proposals;
    state.outbox = snap.outbox;
    state.orderMutations = snap.orderMutations;
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
const post = (server, path, headers = {}) =>
  fetch(`${baseUrl(server)}${path}`, { method: "POST", headers, body: "{}" });

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const delegatedShapeToken = [
  b64url({ alg: "RS256", typ: "JWT" }),
  b64url({ iss: OAUTH_ISSUER, aud: ASSISTANT_AUDIENCE, sub: SELLER, sid: GRANT, shopsphere_user_id: SELLER, shopsphere_role: "seller", shopsphere_verified: true, exp: 9999999999 }),
  "not-a-real-signature",
].join(".");

test("execution applies the exact one-step transition with the stage timestamp, once", async (t) => {
  const client = createFakeClient(createState());
  seedFulfillment(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "executed",
    executionReference: "proposal-exec-prop-fulfill-1",
    saleLineId: SALE_LINE_ID,
    appliedStatus: "Processing",
  });

  const order = client.state.orders.get(SALE_LINE_ID);
  assert.equal(order.status, "Processing");
  assert.ok(order.processingAt instanceof Date); // the single backfilled timestamp
  assert.equal(order.confirmedAt.getTime(), new Date("2026-09-19T08:00:00Z").getTime()); // untouched
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.outbox.length, 1);
  assert.equal(client.state.outbox[0].eventType, "executed");
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "executed");
  assert.equal(client.state.proposals.get("prop-fulfill-1").executionReference, "proposal-exec-prop-fulfill-1");

  // Deterministic replay: identical outcome, no second mutation.
  const retry = await post(server, "/prop-fulfill-1/execute");
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), body);
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.outbox.length, 1);
});

test("cross-seller execution is the identical generic 404 with no mutation and no transition", async (t) => {
  const client = createFakeClient(createState());
  seedFulfillment(client.state);
  const server = await listen(client, { userId: RIVAL });
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 404);
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "pending");
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Confirmed");
});

test("an unverified seller is answered 403 verification_required and nothing changes", async (t) => {
  const client = createFakeClient(createState({ verified: false }));
  seedFulfillment(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, "verification_required");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.outbox.length, 0);
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "pending");
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Confirmed");
});

test("stale when the order moved on after the preview (version proxy mismatch, status still eligible)", async (t) => {
  const client = createFakeClient(createState());
  // A concurrent storefront change (e.g. a refund note) touched the row without
  // changing the status: the version proxy moved past the previewed one.
  seedFulfillment(client.state, { order: saleLineRow({ updatedAt: new Date("2026-09-19T09:30:00.000Z") }) });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.outbox[0].eventType, "stale");
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "stale");
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Confirmed");
});

test("rejected when the status is no longer eligible for the exact next stage", async (t) => {
  const client = createFakeClient(createState());
  // The storefront already advanced the line to Processing: the previewed
  // Confirmed -> Processing step no longer applies (the stored nextStatus is
  // re-derived, never taken from the caller).
  seedFulfillment(client.state, {
    order: saleLineRow({
      status: "Processing",
      processingAt: new Date("2026-09-19T09:30:00Z"),
      updatedAt: new Date("2026-09-19T09:30:00.000Z"),
    }),
  });
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.outbox[0].eventType, "rejected");
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "rejected");
});

test("a pending-payment (Pending status) sale line is rejected at propose AND at execution", async (t) => {
  // Propose: a Pending sale line can never produce a fulfillment proposal —
  // pending payment cannot become confirmed or fulfilled.
  const proposeClient = createFakeClient(createState());
  proposeClient.order.findFirst = async () => saleLineRow({ status: "Pending" });
  await assert.rejects(
    proposeFulfillmentTransition(
      { saleLineId: SALE_LINE_ID, nextStatus: "Processing" },
      { client: proposeClient, principal: { subject: SELLER, role: "seller", clientId: "shopsphere-mcp-client", grantId: GRANT } },
    ),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "not_fulfillable");
      return true;
    },
  );

  // Execution (defense in depth): even a hypothetical pending proposal whose
  // target now sits in Pending is rejected with no mutation.
  const client = createFakeClient(createState());
  seedFulfillment(client.state, { order: saleLineRow({ status: "Pending" }) });
  const server = await listen(client);
  t.after(() => close(server));
  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "rejected");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Pending");
});

test("a lost compare-and-swap rolls the claim back: the proposal stays pending and the order is untouched", async (t) => {
  const client = createFakeClient(createState(), { casFails: true });
  seedFulfillment(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const response = await post(server, "/prop-fulfill-1/execute");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "order_state_changed");
  assert.equal(client.state.orderMutations, 0);
  assert.equal(client.state.outbox.length, 0); // the whole transaction rolled back
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "pending");
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Confirmed");
});

test("concurrent confirmations apply the transition exactly once", async (t) => {
  const client = createFakeClient(createState());
  seedFulfillment(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const [first, second] = await Promise.all([post(server, "/prop-fulfill-1/execute"), post(server, "/prop-fulfill-1/execute")]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(client.state.orderMutations, 1);
  assert.equal(client.state.outbox.filter((event) => event.eventType === "executed").length, 1);
  assert.equal(client.state.proposals.get("prop-fulfill-1").status, "executed");
  assert.equal(client.state.orders.get(SALE_LINE_ID).status, "Processing");
});

test("delegated MCP tokens are rejected on fulfillment review and execution", async (t) => {
  const client = createFakeClient(createState());
  seedFulfillment(client.state);
  const server = await listen(client);
  t.after(() => close(server));

  const headers = { authorization: `Bearer ${delegatedShapeToken}` };
  const review = await fetch(`${baseUrl(server)}/prop-fulfill-1`, { headers });
  assert.equal(review.status, 403);
  assert.equal((await review.json()).code, "delegated_not_allowed");
  const execute = await post(server, "/prop-fulfill-1/execute", headers);
  assert.equal(execute.status, 403);
  assert.equal(client.state.orderMutations, 0);
});

test("fulfillment review exposes the stored preview and the fixed honest side-effect disclosures", async (t) => {
  const client = createFakeClient(createState());
  seedFulfillment(client.state, {
    proposal: fulfillmentProposalRow({
      preview: {
        actionKind: "sale.advance_fulfillment",
        disclosedConsequences: [
          "Sets processingAt on the sale line",
          "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
          "No payment, refund, or stock change happens",
        ],
      },
    }),
  });
  const server = await listen(client);
  t.after(() => close(server));

  const body = await (await fetch(`${baseUrl(server)}/prop-fulfill-1`)).json();
  assert.deepEqual(body.proposal.disclosures, [
    "Sets processingAt on the sale line",
    "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
    "No payment, refund, or stock change happens",
  ]);
});
