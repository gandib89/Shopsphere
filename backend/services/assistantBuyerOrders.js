// Buyer order, tracking, bill, and payment-status reads for issue #13.
// Every operation scopes to the immutable buyer identity (Order.userId =
// subject, never caller-supplied email) and re-scopes each nested relation,
// count, bill, payment, and tracking event independently. Bill reads use
// findFirst only — they never generate or update bills. Payment status omits
// gateway payloads, credentials, and execution authority. Missing or foreign
// ids return a generic not-found error.
import { createCursorCodec } from "./assistantCursor.js";
import { money, toCents } from "./assistantMoney.js";
import { buildBuyerOrderWhere } from "./orderOwnership.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

const { decode: decodeCursor, encode: encodeCursor } = createCursorCodec({ operation: "orders.listMine" });

const STATUSES = Object.freeze([
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
  "ReturnRequested",
  "Returned",
]);

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

const orderSelect = {
  id: true,
  status: true,
  quantity: true,
  totalPrice: true,
  createdAt: true,
  orderGroupId: true,
  product: { select: { name: true } },
};

const orderDetailSelect = {
  ...orderSelect,
  confirmedAt: true,
  processingAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  variantStorage: true,
  variantColor: true,
  variantRam: true,
  variantScreenSize: true,
  variantProcessor: true,
};

const minimizeOrder = (row) => ({
  id: row.id,
  status: row.status,
  quantity: row.quantity,
  totalPrice: money(toCents(row.totalPrice?.toString?.() ?? String(row.totalPrice))),
  createdAt: row.createdAt.toISOString(),
  orderGroupId: row.orderGroupId ?? null,
  productName: row.product?.name?.slice?.(0, 200) ?? null,
});

const minimizeDetail = (row) => ({
  ...minimizeOrder(row),
  variants: {
    storage: row.variantStorage ?? null,
    color: row.variantColor ?? null,
    ram: row.variantRam ?? null,
    screenSize: row.variantScreenSize ?? null,
    processor: row.variantProcessor ?? null,
  },
  confirmedAt: row.confirmedAt?.toISOString?.() ?? null,
  processingAt: row.processingAt?.toISOString?.() ?? null,
  shippedAt: row.shippedAt?.toISOString?.() ?? null,
  deliveredAt: row.deliveredAt?.toISOString?.() ?? null,
  cancelledAt: row.cancelledAt?.toISOString?.() ?? null,
});

const parseBound = (value, name) => {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badInput(`Invalid ${name} date`);
  return date;
};

export const listMyOrders = async (
  { status, from, to, cursor, limit = DEFAULT_LIMIT } = {},
  { client, principal, cursorSecret, now = new Date() },
) => {
  if (status !== undefined && !STATUSES.includes(status)) throw badInput(`Unknown order status: ${status}`);
  const defaultTo = to == null;
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const query = defaultTo
    ? { status: status ?? null, from: from ?? null, defaultTo: true, limit: boundedLimit }
    : { status: status ?? null, from: parseBound(from, "from")?.toISOString() ?? null, to: parseBound(to, "to").toISOString(), limit: boundedLimit };
  const position = decodeCursor(cursor, principal, query, cursorSecret);
  const cursorWindow = defaultTo && position?.state;
  if (cursor && defaultTo && (
    typeof cursorWindow?.from !== "string"
    || typeof cursorWindow?.to !== "string"
    || Number.isNaN(Date.parse(cursorWindow.from))
    || Number.isNaN(Date.parse(cursorWindow.to))
  )) throw notFound();
  const toDate = cursorWindow ? new Date(cursorWindow.to) : parseBound(to, "to") ?? now;
  const fromDate = cursorWindow ? new Date(cursorWindow.from) : parseBound(from, "from") ?? new Date(toDate.getTime() - MAX_INTERVAL_MS);
  if (fromDate > toDate) throw badInput("Invalid order date range");
  if (toDate.getTime() - fromDate.getTime() > MAX_INTERVAL_MS) {
    throw badInput("Order date range must not exceed 90 days");
  }
  const rows = await client.order.findMany({
    where: buildBuyerOrderWhere(principal.subject, {
      ...(status ? { status } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    }),
    select: orderSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    orders: page.map(minimizeOrder),
    nextCursor: rows.length > boundedLimit
      ? encodeCursor(page.at(-1), principal, query, cursorSecret, defaultTo
        ? { from: fromDate.toISOString(), to: toDate.toISOString() }
        : null)
      : null,
  };
};

const loadOwnedOrder = async (client, principal, orderId) => {
  if (!orderId || typeof orderId !== "string" || orderId.length > 100) throw notFound();
  const row = await client.order.findFirst({
    where: buildBuyerOrderWhere(principal.subject, { id: orderId }),
    select: orderDetailSelect,
  });
  if (!row) throw notFound();
  return row;
};

export const getMyOrder = async ({ orderId }, { client, principal }) => {
  const row = await loadOwnedOrder(client, principal, orderId);
  // Group children are re-scoped to the buyer: one matching order never
  // authorizes a whole multi-seller checkout group.
  const groupRows = row.orderGroupId
    ? await client.order.findMany({
      where: { orderGroupId: row.orderGroupId, userId: principal.subject, id: { not: row.id } },
      select: orderSelect,
    })
    : [];
  return { order: minimizeDetail(row), groupOrders: groupRows.map(minimizeOrder) };
};

const FULFILMENT_STAGES = Object.freeze(["Pending", "Confirmed", "Processing", "Shipped", "Delivered"]);

export const trackMyOrder = async ({ orderId }, { client, principal }) => {
  const row = await loadOwnedOrder(client, principal, orderId);
  // Stage-ordered completion: a Confirmed order must not mark Processing,
  // Shipped, or Delivered done. Stored timestamps are ground truth (they also
  // cover terminal states like Cancelled, which sit outside the forward
  // chain); the status comparison only fills gaps where timestamps are missing.
  const stageIndex = FULFILMENT_STAGES.indexOf(row.status);
  const reached = (name) => stageIndex >= 0 && FULFILMENT_STAGES.indexOf(name) <= stageIndex;
  return {
    orderId: row.id,
    status: row.status,
    timeline: [
      { step: "Order Placed", status: "Pending", time: row.createdAt.toISOString(), done: true },
      { step: "Confirmed", status: "Confirmed", time: row.confirmedAt?.toISOString?.() ?? null, done: Boolean(row.confirmedAt) || reached("Confirmed") },
      { step: "Processing", status: "Processing", time: row.processingAt?.toISOString?.() ?? null, done: Boolean(row.processingAt) || reached("Processing") },
      { step: "Shipped", status: "Shipped", time: row.shippedAt?.toISOString?.() ?? null, done: Boolean(row.shippedAt) || reached("Shipped") },
      { step: "Delivered", status: "Delivered", time: row.deliveredAt?.toISOString?.() ?? null, done: Boolean(row.deliveredAt) || reached("Delivered") },
    ],
  };
};

const billSelect = {
  billNumber: true,
  orderId: true,
  productName: true,
  quantity: true,
  unitPrice: true,
  totalPrice: true,
  status: true,
  orderDate: true,
};

export const getMyBillSummary = async ({ orderId }, { client, principal }) => {
  const row = await loadOwnedOrder(client, principal, orderId);
  // Read-only by construction: findFirst on the existing bill. This must
  // never wrap the bill-generating upsert endpoint.
  const bill = await client.bill.findFirst({
    where: { orderId: row.id, userId: principal.subject },
    select: billSelect,
  });
  if (!bill) throw notFound();
  return {
    billNumber: bill.billNumber,
    orderId: bill.orderId,
    productName: bill.productName?.slice?.(0, 200) ?? null,
    quantity: bill.quantity,
    unitPrice: money(toCents(bill.unitPrice?.toString?.() ?? String(bill.unitPrice ?? 0))),
    totalPrice: money(toCents(bill.totalPrice?.toString?.() ?? String(bill.totalPrice ?? 0))),
    status: bill.status,
    orderDate: bill.orderDate?.toISOString?.() ?? null,
  };
};

export const getMyPaymentStatus = async ({ orderId }, { client, principal }) => {
  const row = await loadOwnedOrder(client, principal, orderId);
  // Payments carry no buyer column, so they are scoped through the owned
  // order twice: the order check above plus a relation predicate here, with
  // RLS as the third layer. Only status/amount/currency leave ShopSphere —
  // no gateway reference, callback payload, reconciliation detail, or
  // transfer capability.
  const [payments, refunds] = await Promise.all([
    client.payment.findMany({
      where: { orderId: row.id, order: { userId: principal.subject } },
      select: { status: true, amount: true },
    }),
    client.refund.findMany({
      where: { orderId: row.id, order: { userId: principal.subject } },
      select: { status: true, amount: true },
    }),
  ]);
  return {
    orderId: row.id,
    status: row.status,
    payments: payments.map((payment) => ({
      status: payment.status,
      amount: money(toCents(payment.amount?.toString?.() ?? String(payment.amount))),
    })),
    refunds: refunds.map((refund) => ({
      status: refund.status,
      amount: money(toCents(refund.amount?.toString?.() ?? String(refund.amount))),
    })),
  };
};
