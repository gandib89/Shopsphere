import crypto from "crypto";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { withIdempotency } from "../utils/idempotency.js";
import {
  signCheckoutFields,
  decodeCallbackPayload,
  verifyCallbackSignature,
  checkTransactionStatus,
  FORM_ACTION_URL,
} from "../utils/esewa.js";
import { confirmOrderCore } from "./order.js";

// POST /api/v1/payment/checkout
// Requires Idempotency-Key header. Computes the charge amount from the order in the DB
// (never trusts a client-supplied amount) and signs the eSewa form fields server-side, so the
// signing secret never reaches the browser and the amount can't be tampered with client-side.
export const checkout = async (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey) {
    return res.status(400).json({ message: "Idempotency-Key header is required" });
  }

  const userId = req.user?.id;
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ message: "orderId is required" });
  }

  try {
    const { replayed, statusCode, body } = await withIdempotency(
      idempotencyKey,
      { userId, orderId },
      async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) {
          const err = new Error("Order not found");
          err.statusCode = 404;
          throw err;
        }
        if (order.userId !== userId) {
          const err = new Error("Not authorized for this order");
          err.statusCode = 403;
          throw err;
        }
        if (order.status !== "Pending") {
          const err = new Error(`Order cannot be paid — current status: ${order.status}`);
          err.statusCode = 400;
          throw err;
        }

        const orders = order.orderGroupId
          ? await tx.order.findMany({ where: { orderGroupId: order.orderGroupId } })
          : [order];

        // createOrder() already bakes any promo discount into totalPrice; createBulkOrder()
        // only stores it on promoDiscountAmount (see order.js), so it's only subtracted here
        // for the grouped/bulk case — subtracting it for both would double-discount single orders.
        const groupTotal = orders.reduce((sum, o) => sum + o.totalPrice, 0);
        const discount = order.orderGroupId
          ? orders.reduce((sum, o) => sum + (o.promoDiscountAmount || 0), 0)
          : 0;
        const totalAmount = Math.max(0, groupTotal - discount);

        const transactionUuid = crypto.randomUUID();
        const { signature, signedFieldNames, productCode } = signCheckoutFields({ totalAmount, transactionUuid });

        const payment = await tx.payment.create({
          data: {
            id: generateId(),
            orderId: order.id,
            orderGroupId: order.orderGroupId,
            transactionUuid,
            productCode,
            amount: totalAmount,
            status: "Initiated",
          },
        });

        await tx.paymentEvent.create({
          data: {
            id: generateId(),
            aggregateId: order.id,
            eventType: "intent_created",
            payload: { transactionUuid, amount: totalAmount, productCode, paymentId: payment.id },
          },
        });

        return {
          statusCode: 201,
          body: {
            success: true,
            paymentId: payment.id,
            transactionUuid,
            signature,
            signedFieldNames,
            productCode,
            amount: totalAmount,
            taxAmount: 0,
            totalAmount,
            formActionUrl: FORM_ACTION_URL,
          },
        };
      }
    );

    res.setHeader("Idempotent-Replayed", String(replayed));
    return res.status(statusCode).json(body);
  } catch (error) {
    console.error("Checkout error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message || "Server error during checkout" });
  }
};

// Shared by the success/failure redirect handlers and safe to call more than once for the same
// transaction: dedupes on a per-status gatewayEventId, so a redelivered/duplicate redirect is a
// no-op rather than a second charge confirmation.
export const processEsewaEvent = async (transactionUuid, { source } = {}) => {
  const payment = await prisma.payment.findUnique({ where: { transactionUuid } });
  if (!payment) return { ok: false, reason: "unknown_transaction" };
  if (payment.status !== "Initiated") {
    return { ok: true, payment, alreadyProcessed: true };
  }

  const statusResult = await checkTransactionStatus({
    productCode: payment.productCode,
    totalAmount: payment.amount,
    transactionUuid,
  });

  const newStatus = statusResult.status === "COMPLETE" ? "Succeeded" : "Failed";
  const gatewayEventId = `${transactionUuid}:${statusResult.status}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: {
          id: generateId(),
          aggregateId: payment.orderId,
          eventType: newStatus === "Succeeded" ? "charge_succeeded" : "charge_failed",
          payload: { transactionUuid, source: source || "callback", gatewayResponse: statusResult },
          gatewayEventId,
        },
      });
      await tx.payment.update({
        where: { transactionUuid },
        data: { status: newStatus, gatewayRefId: statusResult.ref_id || null },
      });
    });
  } catch (err) {
    if (err.code === "P2002") {
      // Same gateway event already recorded by a concurrent or redelivered callback.
      const fresh = await prisma.payment.findUnique({ where: { transactionUuid } });
      return { ok: true, payment: fresh, alreadyProcessed: true };
    }
    throw err;
  }

  if (newStatus === "Succeeded") {
    try {
      await confirmOrderCore(payment.orderId);
    } catch (confirmErr) {
      console.error("Post-payment order confirmation failed:", confirmErr);
    }
  }

  return { ok: true, payment: { ...payment, status: newStatus } };
};

const redirectToApp = (req, res, outcome) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const { orderId } = req.params;
  const userAgent = req.headers["user-agent"] || "";
  const isCapacitor = userAgent.includes("Capacitor") || req.headers["x-capacitor"];
  const target = isCapacitor
    ? `capacitor://localhost/#/${outcome}/${orderId}`
    : `${frontendUrl}/#/${outcome}/${orderId}`;
  return res.send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment ${outcome === "success" ? "Successful" : "Failed"}</title></head><body><p>Redirecting...</p><script>setTimeout(function(){ window.location.href = ${JSON.stringify(target)}; }, 300);</script></body></html>`
  );
};

// GET target for eSewa's success_url. eSewa has no server-to-server webhook push — this
// browser redirect, verified against eSewa's own status-check API before anything is trusted,
// is this system's webhook-equivalent entrypoint (see processEsewaEvent above).
export const esewaSuccessWebhook = async (req, res) => {
  try {
    const encoded = req.query.data;
    if (encoded) {
      const payload = decodeCallbackPayload(encoded);
      if (!verifyCallbackSignature(payload)) {
        console.error("eSewa callback signature mismatch", payload);
        return redirectToApp(req, res, "failure");
      }
      await processEsewaEvent(payload.transaction_uuid, { source: "success_redirect" });
    }
  } catch (error) {
    console.error("eSewa success webhook error:", error);
  }
  return redirectToApp(req, res, "success");
};

export const esewaFailureWebhook = async (req, res) => {
  try {
    const encoded = req.query.data;
    if (encoded) {
      const payload = decodeCallbackPayload(encoded);
      if (verifyCallbackSignature(payload)) {
        await processEsewaEvent(payload.transaction_uuid, { source: "failure_redirect" });
      }
    }
  } catch (error) {
    console.error("eSewa failure webhook error:", error);
  }
  return redirectToApp(req, res, "failure");
};
