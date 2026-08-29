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

// createOrder() already bakes any promo discount into totalPrice; createBulkOrder() only
// stores it on promoDiscountAmount (see order.js), so it's only subtracted here for the
// grouped/bulk case — subtracting it for both would double-discount single orders. Pure and
// exported so this exact rule (the actual eSewa charge amount) is independently testable.
export const computeCheckoutAmount = (orders, isGrouped) => {
  const groupTotal = orders.reduce((sum, o) => sum + o.totalPrice, 0);
  const discount = isGrouped
    ? orders.reduce((sum, o) => sum + (o.promoDiscountAmount || 0), 0)
    : 0;
  return Math.max(0, groupTotal - discount);
};

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

        const totalAmount = computeCheckoutAmount(orders, Boolean(order.orderGroupId));

        // A browser retry may use a fresh HTTP idempotency key. Reuse the existing active
        // gateway intent for this logical order so the customer can never receive two
        // simultaneously payable eSewa forms for the same purchase.
        const existingPayment = await tx.payment.findFirst({
          where: { orderId: order.id, status: "Initiated" },
          orderBy: { createdAt: "desc" },
        });
        if (existingPayment) {
          const signed = signCheckoutFields({
            totalAmount: existingPayment.amount,
            transactionUuid: existingPayment.transactionUuid,
            productCode: existingPayment.productCode,
          });
          return {
            statusCode: 200,
            body: {
              success: true,
              paymentId: existingPayment.id,
              transactionUuid: existingPayment.transactionUuid,
              signature: signed.signature,
              signedFieldNames: signed.signedFieldNames,
              productCode: signed.productCode,
              amount: existingPayment.amount,
              taxAmount: 0,
              totalAmount: existingPayment.amount,
              formActionUrl: FORM_ACTION_URL,
              reused: true,
            },
          };
        }

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
export const processEsewaEvent = async (
  transactionUuid,
  { source } = {},
  {
    client = prisma,
    checkStatus = checkTransactionStatus,
    confirmOrder = confirmOrderCore,
  } = {}
) => {
  const payment = await client.payment.findUnique({ where: { transactionUuid } });
  if (!payment) return { ok: false, reason: "unknown_transaction" };
  if (payment.status !== "Initiated") {
    return { ok: true, payment, alreadyProcessed: true };
  }

  const statusResult = await checkStatus({
    productCode: payment.productCode,
    totalAmount: payment.amount,
    transactionUuid,
  });

  const newStatus = statusResult.status === "COMPLETE" ? "Succeeded" : "Failed";
  const gatewayEventId = `${transactionUuid}:${statusResult.status}`;

  // Do not publish a Succeeded payment until the order/stock transaction has committed.
  // If confirmation fails, the payment stays Initiated so a later verified callback can
  // retry instead of leaving a permanently paid-but-pending order.
  if (newStatus === "Succeeded") {
    await confirmOrder(payment.orderId);
  }

  try {
    await client.$transaction(async (tx) => {
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
      const fresh = await client.payment.findUnique({ where: { transactionUuid } });
      return { ok: true, payment: fresh, alreadyProcessed: true };
    }
    throw err;
  }

  return { ok: true, payment: { ...payment, status: newStatus } };
};

const redirectToApp = (req, res, outcome) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const { orderId } = req.params;
  const safeOrderId = /^[a-f\d]{24}$/i.test(orderId) ? orderId : "invalid-order";
  const userAgent = req.headers["user-agent"] || "";
  const isCapacitor = userAgent.includes("Capacitor") || req.headers["x-capacitor"];
  const target = isCapacitor
    ? `capacitor://localhost/#/${outcome}/${safeOrderId}`
    : `${frontendUrl.replace(/\/$/, "")}/#/${outcome}/${safeOrderId}`;
  return res.redirect(302, target);
};

// GET target for eSewa's success_url. eSewa has no server-to-server webhook push — this
// browser redirect, verified against eSewa's own status-check API before anything is trusted,
// is this system's webhook-equivalent entrypoint (see processEsewaEvent above).
export const esewaSuccessWebhook = async (req, res) => {
  let verified = false;
  try {
    const encoded = req.query.data;
    if (encoded) {
      const payload = decodeCallbackPayload(encoded);
      if (!verifyCallbackSignature(payload)) {
        console.error("eSewa callback signature mismatch", payload);
        return redirectToApp(req, res, "failure");
      }
      const result = await processEsewaEvent(payload.transaction_uuid, { source: "success_redirect" });
      verified = result.ok && result.payment?.status === "Succeeded";
    }
  } catch (error) {
    console.error("eSewa success webhook error:", error);
  }
  return redirectToApp(req, res, verified ? "success" : "failure");
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
