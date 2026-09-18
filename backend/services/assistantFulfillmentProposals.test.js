// Adversarial units for the #29 seller fulfillment-transition proposals:
// the attribution predicate uses the immutable sellerIdAtPurchase only,
// foreign/missing/quarantined lines are the identical 404, only the exact
// next seller stage is proposable (pending payment can never be proposed to
// Confirmed or beyond), creation mutates nothing (throwing guards), the
// preview is the exact server-computed snapshot, and the version proxy is the
// shared orderVersionOf epoch-seconds encoding.
import assert from "node:assert/strict";
import test from "node:test";

import {
  FULFILLMENT_ACTION_KIND,
  isFulfillableTransition,
  proposeFulfillmentTransition,
  proposeFulfillmentTransitionInputSchema,
} from "./assistantFulfillmentProposals.js";
import { orderVersionOf, PROPOSAL_TTL_MS } from "./assistantCancellationProposals.js";
import { canonicalPayloadHash } from "./assistantProposals.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const SALE_LINE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2";
const now = new Date("2026-09-19T10:00:00Z");

const principal = (subject = SELLER, grantId = GRANT) => ({
  subject,
  role: "seller",
  clientId: "shopsphere-mcp-client",
  grantId,
});

const confirmedSaleLine = (overrides = {}) => {
  const updatedAt = new Date("2026-09-19T09:00:00Z");
  return {
    id: SALE_LINE_ID,
    orderNumber: "ORD-2026-0042",
    status: "Confirmed",
    confirmedAt: new Date("2026-09-19T08:00:00Z"),
    processingAt: null,
    shippedAt: null,
    deliveredAt: null,
    updatedAt,
    product: { name: "Headphones" },
    ...overrides,
  };
};

const input = { saleLineId: SALE_LINE_ID, nextStatus: "Processing" };

// Fake client with a recording proposal/outbox surface and hard guards on
// every commerce/notification write: if the proposal path ever mutated the
// sale line, touched a payment/refund, or wrote a notification, the test
// fails. Only rows attributed via sellerIdAtPurchase exist in this store.
const createClient = ({ saleLine = confirmedSaleLine(), subject = SELLER } = {}) => {
  const calls = { orderReads: [], proposal: [], outbox: [] };
  const client = {
    calls,
    order: {
      findFirst: async (args) => {
        calls.orderReads.push(args);
        // Mirror the seller attribution predicate: only the caller's own
        // sellerIdAtPurchase rows exist (a NULL attribution never matches).
        if (!saleLine) return null;
        if (args.where?.sellerIdAtPurchase !== subject) return null;
        if (args.where?.id !== saleLine.id) return null;
        return saleLine;
      },
      update: async () => { throw new Error("proposal path must not update the order"); },
      updateMany: async () => { throw new Error("proposal path must not update the order"); },
      create: async () => { throw new Error("proposal path must not create orders"); },
      delete: async () => { throw new Error("proposal path must not delete orders"); },
    },
    notification: {
      create: async () => { throw new Error("proposal path must not create notifications"); },
      createMany: async () => { throw new Error("proposal path must not create notifications"); },
    },
    payment: {
      update: async () => { throw new Error("proposal path must not touch payments"); },
      updateMany: async () => { throw new Error("proposal path must not touch payments"); },
    },
    refund: {
      create: async () => { throw new Error("proposal path must not create refunds"); },
    },
    revenue: {
      update: async () => { throw new Error("proposal path must not touch the revenue ledger"); },
      updateMany: async () => { throw new Error("proposal path must not touch the revenue ledger"); },
    },
    proposal: {
      create: async (args) => { calls.proposal.push(args.data); return args.data; },
      findFirst: async () => null,
      update: async () => { throw new Error("proposal path must not update proposals"); },
    },
    proposalOutboxEvent: {
      create: async (args) => { calls.outbox.push(args.data); return args.data; },
    },
  };
  return client;
};

test("the ownership predicate is the immutable sellerIdAtPurchase attribution only", async () => {
  const client = createClient();
  await proposeFulfillmentTransition(input, { client, principal: principal(), now });

  assert.equal(client.calls.orderReads.length, 1);
  const where = client.calls.orderReads[0].where;
  // Exactly { id, sellerIdAtPurchase } — no OR fallback, no product-ownership
  // join, no caller-supplied seller id.
  assert.deepEqual(where, { id: SALE_LINE_ID, sellerIdAtPurchase: SELLER });
  assert.ok(!("OR" in where));
  assert.ok(!("userId" in where));
  assert.ok(!("product" in where));
});

test("foreign, missing, and quarantined (NULL-attribution) sale lines are the identical generic 404", async () => {
  const cases = [
    createClient({ subject: RIVAL }), // foreign: owned by another seller
    createClient({ saleLine: null }), // missing
  ];
  for (const client of cases) {
    await assert.rejects(
      proposeFulfillmentTransition(input, { client, principal: principal(), now }),
      (error) => {
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "not_found");
        assert.equal(error.message, "Resource not found");
        return true;
      },
    );
    assert.equal(client.calls.proposal.length, 0);
    assert.equal(client.calls.outbox.length, 0);
  }
  // Quarantined legacy rows (NULL sellerIdAtPurchase) can never match the
  // predicate — the fake store simulates that by having the predicate require
  // an exact sellerIdAtPurchase match, so a null-attribution row resolves to
  // null exactly like the RLS policy does.
  const quarantinedStore = createClient();
  quarantinedStore.calls.orderReads.length = 0;
  quarantinedStore.order.findFirst = async (args) => {
    quarantinedStore.calls.orderReads.push(args);
    // The store holds the row but with NULL attribution: the predicate
    // (sellerIdAtPurchase = SELLER) matches nothing.
    return null;
  };
  await assert.rejects(
    proposeFulfillmentTransition(input, { client: quarantinedStore, principal: principal(), now }),
    (error) => error.statusCode === 404 && error.code === "not_found",
  );
  assert.equal(quarantinedStore.calls.proposal.length, 0);
});

test("pending payment can never be proposed to Confirmed, and terminal/return states are rejected with 409 not_fulfillable", async () => {
  const cases = [
    confirmedSaleLine({ status: "Pending" }), // pending payment: no fulfillment step exists
    confirmedSaleLine({ status: "Delivered" }), // terminal for sellers
    confirmedSaleLine({ status: "Cancelled" }),
    confirmedSaleLine({ status: "Return Requested" }),
    confirmedSaleLine({ status: "Return Approved" }),
    confirmedSaleLine({ status: "Refund Released" }),
  ];
  for (const saleLine of cases) {
    const client = createClient({ saleLine });
    await assert.rejects(
      proposeFulfillmentTransition(input, { client, principal: principal(), now }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "not_fulfillable");
        return true;
      },
    );
    assert.equal(client.calls.proposal.length, 0, `no proposal for status ${saleLine.status}`);
    assert.equal(client.calls.outbox.length, 0);
  }
});

test("a wrong next stage is rejected: skipping stages and moving backwards are not proposable", async () => {
  const cases = [
    { saleLine: confirmedSaleLine({ status: "Confirmed" }), nextStatus: "Shipped" }, // skipped Processing
    { saleLine: confirmedSaleLine({ status: "Confirmed" }), nextStatus: "Delivered" }, // skipped two stages
    { saleLine: confirmedSaleLine({ status: "Confirmed" }), nextStatus: "Confirmed" }, // no-op
    { saleLine: confirmedSaleLine({ status: "Processing" }), nextStatus: "Processing" }, // no-op
    { saleLine: confirmedSaleLine({ status: "Processing" }), nextStatus: "Confirmed" }, // backwards
    { saleLine: confirmedSaleLine({ status: "Shipped" }), nextStatus: "Processing" }, // backwards
  ];
  for (const { saleLine, nextStatus } of cases) {
    const client = createClient({ saleLine });
    await assert.rejects(
      proposeFulfillmentTransition({ saleLineId: SALE_LINE_ID, nextStatus }, { client, principal: principal(), now }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "not_fulfillable");
        return true;
      },
    );
    assert.equal(client.calls.proposal.length, 0);
  }
});

test("only the exact storefront seller transitions are fulfillable", () => {
  assert.equal(isFulfillableTransition("Confirmed", "Processing"), true);
  assert.equal(isFulfillableTransition("Processing", "Shipped"), true);
  assert.equal(isFulfillableTransition("Shipped", "Delivered"), true);
  assert.equal(isFulfillableTransition("Pending", "Confirmed"), false); // confirmOrderCore's gate, never a proposal
  assert.equal(isFulfillableTransition("Pending", "Processing"), false);
  assert.equal(isFulfillableTransition("Delivered", "Delivered"), false);
  assert.equal(isFulfillableTransition("Cancelled", "Processing"), false);
  assert.equal(isFulfillableTransition("Return Requested", "Delivered"), false);
  assert.equal(isFulfillableTransition("Confirmed", "Shipped"), false);
});

test("creation persists exactly one canonical pending proposal row and nothing else", async () => {
  const client = createClient();
  const output = await proposeFulfillmentTransition(input, { client, principal: principal(), now });

  assert.equal(client.calls.proposal.length, 1);
  assert.equal(client.calls.outbox.length, 1);
  assert.deepEqual(client.calls.outbox[0], {
    id: client.calls.outbox[0].id,
    proposalId: output.proposalId,
    eventType: "created",
    payloadHash: canonicalPayloadHash(input),
  });

  const data = client.calls.proposal[0];
  assert.equal(data.id, output.proposalId);
  assert.equal(data.subjectId, SELLER);
  assert.equal(data.role, "seller");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, FULFILLMENT_ACTION_KIND);
  assert.equal(data.targetType, "order");
  assert.equal(data.targetId, SALE_LINE_ID);
  assert.equal(data.status, "pending");
  assert.deepEqual(data.canonicalPayload, input);
  assert.equal(data.payloadHash, canonicalPayloadHash(input));
  assert.equal(data.expiresAt.getTime(), now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, data.expiresAt.toISOString());
});

test("the preview is the exact server-computed snapshot with the fixed honest disclosures", async () => {
  const client = createClient();
  const output = await proposeFulfillmentTransition(input, { client, principal: principal(), now });

  assert.deepEqual(output.preview, {
    actionKind: FULFILLMENT_ACTION_KIND,
    saleLineId: SALE_LINE_ID,
    orderNumber: "ORD-2026-0042",
    productName: "Headphones",
    currentStatus: "Confirmed", // exact stored storefront string
    nextStatus: "Processing",
    stageTimestamps: {
      confirmedAt: "2026-09-19T08:00:00.000Z",
      processingAt: null,
      shippedAt: null,
      deliveredAt: null,
    },
    willSetTimestamp: "processingAt", // the single field this transition backfills
    disclosedConsequences: [
      "Sets processingAt on the sale line",
      "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
      "No payment, refund, or stock change happens",
    ],
  });
  // The stored preview is the identical server-computed object, and the
  // version proxy is the shared orderVersionOf epoch-seconds encoding.
  assert.deepEqual(client.calls.proposal[0].preview, output.preview);
  assert.equal(client.calls.proposal[0].expectedVersion, orderVersionOf(confirmedSaleLine()));
});

test("Shipped to Delivered backfills deliveredAt and reports the timestamps already present", async () => {
  const client = createClient({
    saleLine: confirmedSaleLine({
      status: "Shipped",
      shippedAt: new Date("2026-09-19T09:30:00Z"),
    }),
  });
  const output = await proposeFulfillmentTransition(
    { saleLineId: SALE_LINE_ID, nextStatus: "Delivered" },
    { client, principal: principal(), now },
  );
  assert.equal(output.preview.currentStatus, "Shipped");
  assert.equal(output.preview.nextStatus, "Delivered");
  assert.equal(output.preview.willSetTimestamp, "deliveredAt");
  assert.equal(output.preview.stageTimestamps.shippedAt, "2026-09-19T09:30:00.000Z");
  assert.equal(output.preview.stageTimestamps.deliveredAt, null);
  assert.equal(client.calls.proposal[0].canonicalPayload.nextStatus, "Delivered");
});

test("no currentStatus, confirm, or execute field exists anywhere in the input contract", async () => {
  // The route schema is the closed field set: currentStatus (server-derived),
  // confirm/execute affordances, and seller identity fields all fail strict
  // parsing before any service code runs.
  const schema = proposeFulfillmentTransitionInputSchema;
  assert.ok(schema.safeParse(input).success);
  assert.ok(!schema.safeParse({ ...input, currentStatus: "Pending" }).success);
  assert.ok(!schema.safeParse({ ...input, confirm: true }).success);
  assert.ok(!schema.safeParse({ ...input, executeNow: true }).success);
  assert.ok(!schema.safeParse({ ...input, sellerId: SELLER }).success);
  assert.ok(!schema.safeParse({ ...input, orderId: "x" }).success);
  assert.ok(!schema.safeParse({ saleLineId: SALE_LINE_ID }).success);
  assert.ok(!schema.safeParse({ nextStatus: "Processing" }).success);
  assert.ok(!schema.safeParse({ ...input, nextStatus: "Confirmed" }).success);
  assert.ok(!schema.safeParse({ ...input, nextStatus: "Cancelled" }).success);
  assert.ok(!schema.safeParse({ saleLineId: "short", nextStatus: "Processing" }).success);
  assert.ok(!schema.safeParse({ ...input, extra: 1 }).success);

  const client = createClient();
  const output = await proposeFulfillmentTransition(input, { client, principal: principal(), now });
  // The stored input contract is exactly { saleLineId, nextStatus } — no
  // caller-supplied currentStatus (the preview's own currentStatus is
  // server-derived), no confirm/execute affordance, no seller identity.
  assert.deepEqual(Object.keys(client.calls.proposal[0].canonicalPayload), ["saleLineId", "nextStatus"]);
  const serialized = JSON.stringify({ output, stored: client.calls.proposal[0] });
  for (const banned of ['"confirm"', '"executeNow"', '"approved"']) {
    assert.ok(!serialized.includes(banned), `unexpected field: ${banned}`);
  }
  assert.deepEqual(Object.keys(output), ["proposalId", "status", "expiresAt", "preview"]);
});
