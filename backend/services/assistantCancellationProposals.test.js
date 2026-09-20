import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import {
  CANCELLATION_ACTION_KIND,
  canonicalPayloadHash,
  orderVersionOf,
  proposeOrderCancellation,
  PROPOSAL_TTL_MS,
} from "./assistantCancellationProposals.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const now = new Date("2026-09-18T10:00:00Z");
const UPDATED_AT = new Date("2026-09-18T09:59:59.250Z");

const principal = (subject = BUYER, grantId = GRANT) => ({
  subject,
  role: "user",
  clientId: "shopsphere-mcp-client",
  grantId,
});

const input = { orderId: "order-1" };

const orderRow = (overrides = {}) => ({
  id: "order-1",
  orderNumber: "ORD-2026-0001",
  status: "Pending",
  quantity: 3,
  productId: "prod-1",
  variantColor: null,
  variantStorage: null,
  updatedAt: UPDATED_AT,
  ...overrides,
});

// Fake client with hard guards on every commerce-mutation surface: if the
// proposal path ever wrote an order, product, payment, refund, revenue, bill,
// or notification row, the test fails at the write itself. All reads and the
// proposal/outbox writes are recorded.
const createClient = ({ order = orderRow(), payment = null } = {}) => {
  const calls = { orderReads: [], paymentReads: [], proposal: [], outbox: [] };
  const client = {
    calls,
    order: {
      findFirst: async (args) => {
        calls.orderReads.push(args);
        const where = args.where ?? {};
        if (!order) return null;
        if (where.userId !== BUYER || where.id !== order.id) return null;
        return order;
      },
      update: async () => { throw new Error("proposal path must not update the order"); },
      updateMany: async () => { throw new Error("proposal path must not update the order"); },
      create: async () => { throw new Error("proposal path must not create the order"); },
      delete: async () => { throw new Error("proposal path must not delete the order"); },
    },
    product: {
      update: async () => { throw new Error("proposal path must not touch stock"); },
      updateMany: async () => { throw new Error("proposal path must not touch stock"); },
      findUnique: async () => { throw new Error("proposal path must not need the product"); },
    },
    productColorVariant: {
      updateMany: async () => { throw new Error("proposal path must not touch stock"); },
    },
    productStorageVariant: {
      updateMany: async () => { throw new Error("proposal path must not touch stock"); },
    },
    payment: {
      findFirst: async (args) => {
        calls.paymentReads.push(args);
        // Honor the Prisma predicate: the service only accepts a succeeded
        // payment scoped through the owned order.
        if (!payment) return null;
        if (args.where?.status && payment.status !== args.where.status) return null;
        if (args.where?.orderId && args.where.orderId !== order.id) return null;
        return payment;
      },
      update: async () => { throw new Error("proposal path must not update payments"); },
      create: async () => { throw new Error("proposal path must not create payments"); },
    },
    refund: {
      findFirst: async () => { throw new Error("proposal path must not read refunds"); },
      create: async () => { throw new Error("proposal path must not create refunds"); },
      update: async () => { throw new Error("proposal path must not update refunds"); },
    },
    revenue: {
      update: async () => { throw new Error("proposal path must not update revenue"); },
      updateMany: async () => { throw new Error("proposal path must not update revenue"); },
    },
    bill: {
      update: async () => { throw new Error("proposal path must not update bills"); },
      create: async () => { throw new Error("proposal path must not create bills"); },
    },
    notification: {
      create: async () => { throw new Error("proposal path must not create notifications"); },
      update: async () => { throw new Error("proposal path must not update notifications"); },
    },
    proposal: {
      create: async (args) => { calls.proposal.push(args.data); return args.data; },
      findFirst: async () => null,
    },
    proposalOutboxEvent: {
      create: async (args) => { calls.outbox.push(args.data); return args.data; },
    },
  };
  return client;
};

test("propose persists exactly one canonical pending proposal and nothing else", async () => {
  const client = createClient({ order: orderRow({ status: "Confirmed" }) });
  const output = await proposeOrderCancellation(input, { client, principal: principal(), now });

  assert.equal(client.calls.proposal.length, 1);
  assert.equal(client.calls.outbox.length, 1);
  // The only writes are the proposal row and its "created" outbox event.
  assert.deepEqual(client.calls.outbox[0], {
    id: client.calls.outbox[0].id,
    proposalId: output.proposalId,
    eventType: "created",
    payloadHash: canonicalPayloadHash(input),
  });

  const data = client.calls.proposal[0];
  assert.equal(data.id, output.proposalId);
  assert.equal(data.subjectId, BUYER);
  assert.equal(data.role, "user");
  assert.equal(data.clientId, "shopsphere-mcp-client");
  assert.equal(data.grantId, GRANT);
  assert.equal(data.actionKind, "order.cancel");
  assert.equal(data.targetType, "order");
  assert.equal(data.targetId, "order-1");
  assert.deepEqual(data.canonicalPayload, input);
  assert.equal(data.payloadHash, crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"));
  assert.equal(data.status, "pending");
  assert.equal(data.expiresAt.getTime(), now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  assert.equal(output.status, "pending");
  assert.equal(output.expiresAt, data.expiresAt.toISOString());
});

test("the order predicate is the immutable userId attribution only", async () => {
  const client = createClient();
  await proposeOrderCancellation(input, { client, principal: principal(), now });

  assert.equal(client.calls.orderReads.length, 1);
  const where = client.calls.orderReads[0].where;
  // Exactly buildBuyerOrderWhere(subject, { id }) — no email fallback, no OR,
  // no sellerId, no present-day product-owner join.
  assert.deepEqual(where, { id: "order-1", userId: BUYER });
  assert.ok(!("email" in where));
  assert.ok(!("OR" in where));
  assert.ok(!("sellerIdAtPurchase" in where));
});

test("foreign and missing orders are the identical generic 404 and create nothing", async () => {
  // Foreign: the predicate keys on the subject, so another buyer's order is
  // indistinguishable from a missing one.
  const foreignClient = createClient({ order: orderRow({ userId: BUYER }) });
  await assert.rejects(
    proposeOrderCancellation(input, { client: foreignClient, principal: principal(RIVAL), now }),
    { statusCode: 404, code: "not_found" },
  );
  assert.equal(foreignClient.calls.proposal.length, 0);
  assert.equal(foreignClient.calls.outbox.length, 0);

  const missingClient = createClient({ order: null });
  await assert.rejects(
    proposeOrderCancellation(input, { client: missingClient, principal: principal(), now }),
    { statusCode: 404, code: "not_found" },
  );
  assert.equal(missingClient.calls.proposal.length, 0);
});

test("an owned but ineligible order creates NO proposal and fails deterministically (400, not the 404 path)", async () => {
  for (const status of ["Processing", "Shipped", "Delivered", "Cancelled", "Refund Released"]) {
    const client = createClient({ order: orderRow({ status }) });
    // Documented design: owned-but-ineligible is a deterministic business
    // denial with statusCode 400 (the route maps it to the generic
    // invalid_input body). 404 stays reserved for foreign/missing identity so
    // no existence information leaks through eligibility.
    await assert.rejects(
      proposeOrderCancellation(input, { client, principal: principal(), now }),
      { statusCode: 400, code: "order_not_cancellable" },
    );
    assert.equal(client.calls.proposal.length, 0);
    assert.equal(client.calls.outbox.length, 0);
  }
});

test("preview math: Pending order restores 0 stock and reports no paid amount", async () => {
  const client = createClient({ order: orderRow({ status: "Pending", quantity: 3 }) });
  const output = await proposeOrderCancellation(input, { client, principal: principal(), now });

  assert.deepEqual(output.preview, {
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
  });
});

test("preview math: Confirmed order restores the exact quantity and the succeeded payment amount", async () => {
  const client = createClient({
    order: orderRow({ status: "Confirmed", quantity: 2, variantColor: "Black", variantStorage: "512GB" }),
    payment: { status: "Succeeded", amount: "1890.50" },
  });
  const output = await proposeOrderCancellation(input, { client, principal: principal(), now });

  assert.equal(output.preview.stockToRestore, 2);
  // Canonical exact-decimal form via assistantMoney (trailing zero dropped).
  assert.deepEqual(output.preview.paidAmount, { amount: "1890.5", currency: "NPR" });
  assert.equal(output.preview.currentStatus, "Confirmed");
  assert.equal(output.preview.cancelEligible, true);
  assert.deepEqual(output.preview.disclosedConsequences, [
    "Cancels the order",
    "Restores 2 item(s) to stock",
    "Any refund is a separate manual admin action and is NOT initiated here",
  ]);
  // The succeeded payment is scoped through the owned order, not by id alone.
  assert.deepEqual(client.calls.paymentReads[0].where, {
    orderId: "order-1",
    order: { userId: BUYER },
    status: "Succeeded",
  });
});

test("failed or pending payments are never disclosed as paidAmount", async () => {
  for (const payment of [null, { status: "Failed", amount: "100.00" }, { status: "Initiated", amount: "100.00" }]) {
    const client = createClient({ order: orderRow({ status: "Confirmed" }), payment });
    const output = await proposeOrderCancellation(input, { client, principal: principal(), now });
    assert.equal(output.preview.paidAmount, null);
  }
});

test("expectedVersion is the orderVersionOf updatedAt proxy, shared with execution", async () => {
  const client = createClient();
  await proposeOrderCancellation(input, { client, principal: principal(), now });

  const stored = client.calls.proposal[0].expectedVersion;
  // Epoch seconds (int4-safe), not raw milliseconds, derived exactly as the
  // execution route re-derives it.
  assert.equal(stored, Math.floor(UPDATED_AT.getTime() / 1000));
  assert.equal(orderVersionOf({ updatedAt: UPDATED_AT }), stored);
  assert.equal(orderVersionOf({ updatedAt: UPDATED_AT.toISOString() }), stored);
  // Any later mutation of the row moves the proxy and would go stale.
  assert.notEqual(orderVersionOf({ updatedAt: new Date(UPDATED_AT.getTime() + 1000) }), stored);
});

test("preview exposes no refund state beyond the paid amount disclosure", async () => {
  const client = createClient({
    order: orderRow({ status: "Confirmed" }),
    payment: { status: "Succeeded", amount: "500.00" },
  });
  const output = await proposeOrderCancellation(input, { client, principal: principal(), now });
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes("refundId"));
  assert.ok(!serialized.includes("refundStatus"));
  assert.ok(!serialized.includes("gateway"));
  assert.ok(!serialized.includes("provider"));
  assert.equal(CANCELLATION_ACTION_KIND, "order.cancel");
});

test("a null orderNumber stays null instead of lying about the snapshot", async () => {
  const client = createClient({ order: orderRow({ orderNumber: null }) });
  const output = await proposeOrderCancellation(input, { client, principal: principal(), now });
  assert.equal(output.preview.orderNumber, null);
});
