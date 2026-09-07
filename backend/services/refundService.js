import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";

const serviceError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const reverseRevenue = async (orderId, tx) => {
  const revenue = await tx.revenue.findFirst({ where: { orderId } });
  if (!revenue) return;
  await tx.revenue.update({
    where: { id: revenue.id },
    data: { status: "Refunded", totalSalePrice: 0, adminCommission: 0, sellerRevenue: 0 },
  });
};

const findRefundOrder = (client, orderId) => client.order.findUnique({
  where: { id: orderId },
  include: {
    product: true,
    payments: { where: { status: "Succeeded" }, orderBy: { createdAt: "desc" }, take: 1 },
  },
});

export const processRefundCore = async (
  { orderId, idempotencyKey },
  { client = prisma, provider, mode = "sandbox", now = () => new Date() } = {},
) => {
  if (!provider) throw serviceError(500, "Refund provider is not configured");

  let claim;
  try {
    claim = await client.$transaction(async (tx) => {
      const order = await findRefundOrder(tx, orderId);
      if (!order) throw serviceError(404, "Order not found");

      const payment = order.payments?.[0];
      if (!payment) throw serviceError(409, "A succeeded payment is required before refunding this order");

      const existing = await tx.refund.findUnique({ where: { paymentId: payment.id } });
      if (existing?.status === "Succeeded") return { order, payment, refund: existing, replayed: true };
      if (existing?.status === "Processing") throw serviceError(409, "This refund is already processing");

      if (!["Return Approved", "Cancelled"].includes(order.status)) {
        throw serviceError(409, `Refund requires an approved return or paid cancellation. Current status: ${order.status}`);
      }

      if (existing?.status === "Failed") {
        const retry = await tx.refund.updateMany({
          where: { id: existing.id, status: "Failed" },
          data: { status: "Processing", failureReason: null },
        });
        if (retry.count === 0) throw serviceError(409, "Refund state changed; refresh and try again");
        return { order, payment, refund: { ...existing, status: "Processing", failureReason: null }, replayed: false };
      }

      const refund = await tx.refund.create({
        data: {
          id: generateId(), paymentId: payment.id, orderId: order.id, amount: payment.amount,
          status: "Processing", mode, idempotencyKey,
        },
      });
      return { order, payment, refund, replayed: false };
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const order = await findRefundOrder(client, orderId);
    const payment = order?.payments?.[0];
    const existing = payment ? await client.refund.findUnique({ where: { paymentId: payment.id } }) : null;
    if (existing?.status === "Succeeded") return { order, refund: existing, replayed: true };
    throw serviceError(409, "This refund is already processing");
  }

  if (claim.replayed) return { order: claim.order, refund: claim.refund, replayed: true };

  let outcome;
  try {
    outcome = await provider.refund({
      payment: claim.payment,
      amount: claim.refund.amount,
      idempotencyKey: claim.refund.idempotencyKey,
    });
  } catch (error) {
    outcome = { status: "Failed", failureReason: error.message || "Refund provider request failed" };
  }
  const succeeded = outcome.status === "Succeeded";

  return client.$transaction(async (tx) => {
    const settled = await tx.refund.updateMany({
      where: { id: claim.refund.id, status: "Processing" },
      data: {
        status: succeeded ? "Succeeded" : "Failed",
        providerRefundId: outcome.providerRefundId || null,
        failureReason: succeeded ? null : outcome.failureReason || "Refund failed",
        completedAt: succeeded ? now() : null,
      },
    });
    if (settled.count === 0) throw serviceError(409, "Refund state changed while it was processing");

    if (succeeded) {
      const released = await tx.order.updateMany({
        where: { id: orderId, status: claim.order.status },
        data: { status: "Refund Released", refundReleasedAt: now() },
      });
      if (released.count === 0) throw serviceError(409, "Order state changed while the refund was processing");
      await reverseRevenue(orderId, tx);
    }

    await tx.paymentEvent.create({
      data: {
        id: generateId(), aggregateId: orderId,
        eventType: succeeded ? "refund_succeeded" : "refund_failed",
        payload: {
          refundId: claim.refund.id, paymentId: claim.payment.id, amount: claim.refund.amount,
          mode, providerRefundId: outcome.providerRefundId || null,
          failureReason: succeeded ? null : outcome.failureReason || "Refund failed",
        },
      },
    });

    return {
      order: await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { product: true } }),
      refund: await tx.refund.findUnique({ where: { id: claim.refund.id } }),
      replayed: false,
    };
  });
};
