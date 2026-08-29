import assert from "node:assert/strict";
import test from "node:test";

import { computeCheckoutAmount, processEsewaEvent } from "./payment.js";

// ─── computeCheckoutAmount ─────────────────────────────────────────────────────
// This number becomes the actual eSewa charge — see checkout()'s comment on why grouped vs
// single orders apply the promo discount differently.

test("computeCheckoutAmount sums plain order totals for a single (non-grouped) order", () => {
  const amount = computeCheckoutAmount([{ totalPrice: 1500, promoDiscountAmount: null }], false);
  assert.equal(amount, 1500);
});

test("computeCheckoutAmount ignores promoDiscountAmount for a single order (already baked into totalPrice)", () => {
  // If this subtracted the discount again here, the customer would be double-discounted.
  const amount = computeCheckoutAmount([{ totalPrice: 1500, promoDiscountAmount: 200 }], false);
  assert.equal(amount, 1500);
});

test("computeCheckoutAmount sums across a group and subtracts the discount once", () => {
  const orders = [
    { totalPrice: 1000, promoDiscountAmount: 100 },
    { totalPrice: 500, promoDiscountAmount: 0 },
  ];
  const amount = computeCheckoutAmount(orders, true);
  assert.equal(amount, 1400); // 1500 - 100, not 1500 - 100 - 100
});

test("computeCheckoutAmount never goes negative even if a discount exceeds the total", () => {
  const amount = computeCheckoutAmount([{ totalPrice: 100, promoDiscountAmount: 9999 }], true);
  assert.equal(amount, 0);
});

// ─── processEsewaEvent ──────────────────────────────────────────────────────────
const createFakePaymentClient = (payment) => {
  const state = { payment: payment ? { ...payment } : null, events: [] };
  return {
    state,
    payment: {
      findUnique: async () => (state.payment ? { ...state.payment } : null),
    },
    $transaction: async (fn) => {
      const tx = {
        paymentEvent: {
          create: async ({ data }) => {
            if (state.events.some((e) => e.gatewayEventId && e.gatewayEventId === data.gatewayEventId)) {
              const err = new Error("duplicate gateway event");
              err.code = "P2002";
              throw err;
            }
            state.events.push(data);
            return { ...data };
          },
        },
        payment: {
          update: async ({ data }) => {
            Object.assign(state.payment, data);
            return { ...state.payment };
          },
        },
      };
      return fn(tx);
    },
  };
};

test("processEsewaEvent reports unknown_transaction for a transaction with no Payment row", async () => {
  const client = createFakePaymentClient(null);
  const result = await processEsewaEvent("tx-missing", {}, { client, checkStatus: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(result, { ok: false, reason: "unknown_transaction" });
});

test("processEsewaEvent is a no-op (idempotent) once a payment is no longer Initiated", async () => {
  const client = createFakePaymentClient({ transactionUuid: "tx1", status: "Succeeded", orderId: "o1" });
  const confirmOrder = async () => { throw new Error("must not re-confirm"); };
  const result = await processEsewaEvent("tx1", {}, { client, checkStatus: async () => { throw new Error("must not re-check"); }, confirmOrder });
  assert.equal(result.alreadyProcessed, true);
  assert.equal(result.payment.status, "Succeeded");
});

test("processEsewaEvent marks Succeeded and confirms the order when eSewa's own status check says COMPLETE", async () => {
  const client = createFakePaymentClient({ transactionUuid: "tx2", status: "Initiated", orderId: "o2", productCode: "EPAYTEST", amount: 1000 });
  let confirmedOrderId = null;
  const confirmOrder = async (orderId) => { confirmedOrderId = orderId; };
  const checkStatus = async () => ({ status: "COMPLETE", ref_id: "REF123" });

  const result = await processEsewaEvent("tx2", { source: "success_redirect" }, { client, checkStatus, confirmOrder });

  assert.equal(result.ok, true);
  assert.equal(result.payment.status, "Succeeded");
  assert.equal(client.state.payment.status, "Succeeded");
  assert.equal(client.state.payment.gatewayRefId, "REF123");
  assert.equal(confirmedOrderId, "o2");
});

test("processEsewaEvent marks Failed and does NOT confirm the order when eSewa says anything but COMPLETE", async () => {
  const client = createFakePaymentClient({ transactionUuid: "tx3", status: "Initiated", orderId: "o3", productCode: "EPAYTEST", amount: 1000 });
  const confirmOrder = async () => { throw new Error("must not confirm a failed payment"); };
  const checkStatus = async () => ({ status: "CANCELED" });

  const result = await processEsewaEvent("tx3", {}, { client, checkStatus, confirmOrder });

  assert.equal(result.payment.status, "Failed");
  assert.equal(client.state.payment.status, "Failed");
});

test("processEsewaEvent treats a redelivered/duplicate gateway callback as already-processed", async () => {
  // Simulates the race the try/catch(P2002) branch exists for: our own top-of-function read
  // still saw "Initiated", but by the time our transaction tries to insert the PaymentEvent,
  // a concurrent callback for the same transaction has already committed both that row and
  // the payment-status update — Postgres reports the unique-constraint collision right then.
  const state = { payment: { transactionUuid: "tx4", status: "Initiated", orderId: "o4", productCode: "EPAYTEST", amount: 1000 }, events: [] };
  const client = {
    payment: { findUnique: async () => ({ ...state.payment }) },
    $transaction: async (fn) => fn({
      paymentEvent: {
        create: async () => {
          // The concurrent transaction's commit becomes visible right as ours collides.
          state.payment.status = "Succeeded";
          const err = new Error("duplicate gateway event");
          err.code = "P2002";
          throw err;
        },
      },
      payment: { update: async () => { throw new Error("must not reach update on a losing insert"); } },
    }),
  };

  let confirmCalls = 0;
  const confirmOrder = async () => { confirmCalls += 1; };
  const checkStatus = async () => ({ status: "COMPLETE" });

  const result = await processEsewaEvent("tx4", {}, { client, checkStatus, confirmOrder });

  assert.equal(result.alreadyProcessed, true);
  assert.equal(result.payment.status, "Succeeded");
  // Confirmation runs before Succeeded is published. confirmOrderCore atomically claims a
  // Pending order, so a stale concurrent caller is safe and becomes a no-op there.
  assert.equal(confirmCalls, 1);
});

test("processEsewaEvent leaves payment retryable when order confirmation fails", async () => {
  const client = createFakePaymentClient({ transactionUuid: "tx5", status: "Initiated", orderId: "o5", productCode: "EPAYTEST", amount: 1000 });
  const confirmOrder = async () => { throw new Error("stock transaction failed"); };

  await assert.rejects(
    processEsewaEvent("tx5", {}, { client, checkStatus: async () => ({ status: "COMPLETE" }), confirmOrder }),
    /stock transaction failed/
  );
  assert.equal(client.state.payment.status, "Initiated");
  assert.equal(client.state.events.length, 0);
});
