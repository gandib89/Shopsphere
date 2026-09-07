import assert from "node:assert/strict";
import test from "node:test";

import { processRefundCore } from "./refundService.js";

const createRefundClient = () => {
  const state = {
    order: { id: "o1", status: "Return Approved", totalPrice: 500, refundReleasedAt: null },
    payment: { id: "pay1", orderId: "o1", status: "Succeeded", amount: 500, transactionUuid: "txn1" },
    refund: null,
    events: [],
    revenue: { id: "rev1", orderId: "o1", status: "Completed", totalSalePrice: 500, adminCommission: 25, sellerRevenue: 475 },
  };
  const client = {
    state,
    order: {
      findUnique: async () => ({ ...state.order, payments: [{ ...state.payment }] }),
      updateMany: async ({ where, data }) => {
        if (state.order.status !== where.status) return { count: 0 };
        Object.assign(state.order, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...state.order }),
    },
    refund: {
      findUnique: async ({ where }) => {
        if (!state.refund) return null;
        if (where.paymentId && state.refund.paymentId !== where.paymentId) return null;
        if (where.id && state.refund.id !== where.id) return null;
        return { ...state.refund };
      },
      create: async ({ data }) => {
        if (state.refund) { const error = new Error("unique"); error.code = "P2002"; throw error; }
        state.refund = { ...data, createdAt: new Date(), updatedAt: new Date() };
        return { ...state.refund };
      },
      updateMany: async ({ where, data }) => {
        if (!state.refund || state.refund.id !== where.id || state.refund.status !== where.status) return { count: 0 };
        Object.assign(state.refund, data);
        return { count: 1 };
      },
      findFirst: async () => state.refund ? { ...state.refund } : null,
    },
    paymentEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
    revenue: {
      findFirst: async () => ({ ...state.revenue }),
      update: async ({ data }) => { Object.assign(state.revenue, data); return { ...state.revenue }; },
    },
  };
  client.$transaction = async (fn) => fn(client);
  return client;
};

test("a successful sandbox refund releases the order and reverses revenue atomically", async () => {
  const client = createRefundClient();
  const provider = { refund: async () => ({ status: "Succeeded", providerRefundId: "sandbox-refund-txn1" }) };
  const result = await processRefundCore({ orderId: "o1", idempotencyKey: "refund:o1" }, { client, provider, mode: "sandbox" });
  assert.equal(result.refund.status, "Succeeded");
  assert.equal(result.order.status, "Refund Released");
  assert.equal(client.state.revenue.status, "Refunded");
  assert.equal(client.state.revenue.totalSalePrice, 0);
  assert.equal(client.state.events[0].eventType, "refund_succeeded");
});

test("a failed sandbox refund remains retryable and does not alter the order or revenue", async () => {
  const client = createRefundClient();
  const provider = { refund: async () => ({ status: "Failed", failureReason: "Simulated rejection" }) };
  const result = await processRefundCore({ orderId: "o1", idempotencyKey: "refund:o1" }, { client, provider, mode: "sandbox" });
  assert.equal(result.refund.status, "Failed");
  assert.equal(client.state.order.status, "Return Approved");
  assert.equal(client.state.revenue.status, "Completed");
  assert.equal(client.state.events[0].eventType, "refund_failed");
});

test("a paid cancellation can use the same refund workflow", async () => {
  const client = createRefundClient();
  client.state.order.status = "Cancelled";
  const provider = { refund: async () => ({ status: "Succeeded", providerRefundId: "sandbox-refund-txn1" }) };
  const result = await processRefundCore({ orderId: "o1", idempotencyKey: "refund:o1" }, { client, provider, mode: "sandbox" });
  assert.equal(result.refund.status, "Succeeded");
  assert.equal(result.order.status, "Refund Released");
});

test("repeating a completed refund returns the existing result without calling the provider twice", async () => {
  const client = createRefundClient();
  let calls = 0;
  const provider = { refund: async () => { calls += 1; return { status: "Succeeded", providerRefundId: "sandbox-refund-txn1" }; } };
  const first = await processRefundCore({ orderId: "o1", idempotencyKey: "refund:o1" }, { client, provider, mode: "sandbox" });
  const second = await processRefundCore({ orderId: "o1", idempotencyKey: "refund:o1" }, { client, provider, mode: "sandbox" });
  assert.equal(first.refund.id, second.refund.id);
  assert.equal(second.replayed, true);
  assert.equal(calls, 1);
});
