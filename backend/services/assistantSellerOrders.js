// Seller sale-line and revenue reads for issue #15.
// Sale lines are authorized through the immutable seller-at-purchase
// attribution (Order.sellerIdAtPurchase = subject via buildSellerOrderWhere) —
// never current Product.sellerId and never a caller-supplied seller id. Rows
// whose attribution is still NULL (legacy/unrepaired) are quarantined from
// these reads. Customer identity leaves only as a deterministic opaque
// reference; names, emails, addresses, and delivery details are never selected.
// Revenue aggregates read the historical ledger (Revenue.sellerId, captured at
// sale creation and never reassigned) with exact paisa arithmetic: every
// amount is parsed to integer minor units, summed with integers, and formatted
// back — no JavaScript floating point ever touches a total.
import crypto from "node:crypto";

import { createCursorCodec } from "./assistantCursor.js";
import { money, toCents } from "./assistantMoney.js";
import { buildSellerOrderWhere } from "./orderOwnership.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const { decode: decodeCursor, encode: encodeCursor } = createCursorCodec({ operation: "sales.listMine" });

const STATUSES = Object.freeze([
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
  "ReturnRequested",
  "Returned",
  // Set by the refund release flow; a sale line can enter it after delivery.
  "Refund Released",
]);

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Opaque, stable customer reference: a truncated digest of the buyer id. It
// lets a seller correlate repeat buyers without disclosing names, emails, or
// the raw account id. Orders with a NULL buyer (legacy rows) are quarantined
// from these reads anyway, so the null branch is defense in depth.
const buyerReference = (userId) => (userId
  ? `buyer-${crypto.createHash("sha256").update(`shopsphere-buyer:${userId}`).digest("hex").slice(0, 12)}`
  : null);

const saleSelect = {
  id: true,
  status: true,
  quantity: true,
  totalPrice: true,
  createdAt: true,
  orderGroupId: true,
  userId: true,
  productId: true,
  product: { select: { name: true } },
};

const saleDetailSelect = {
  ...saleSelect,
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

const minimizeSale = (row) => ({
  id: row.id,
  status: row.status,
  quantity: row.quantity,
  totalPrice: money(toCents(row.totalPrice?.toString?.() ?? String(row.totalPrice))),
  createdAt: row.createdAt.toISOString(),
  orderGroupId: row.orderGroupId ?? null,
  productId: row.productId,
  productName: row.product?.name?.slice?.(0, 200) ?? null,
  buyerReference: buyerReference(row.userId),
});

const parseBound = (value, name) => {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badInput(`Invalid ${name} date`);
  return date;
};

export const listMySales = async (
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
    where: buildSellerOrderWhere(principal.subject, {
      ...(status ? { status } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    }),
    select: saleSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    sales: page.map(minimizeSale),
    nextCursor: rows.length > boundedLimit
      ? encodeCursor(page.at(-1), principal, query, cursorSecret, defaultTo
        ? { from: fromDate.toISOString(), to: toDate.toISOString() }
        : null)
      : null,
  };
};

const cents = (value) => (value == null ? 0 : toCents(value.toString?.() ?? String(value)));

const minimizeRevenue = (row) => ({
  status: row.status,
  grossSale: money(cents(row.totalSalePrice)),
  commission: money(cents(row.adminCommission)),
  netSale: money(cents(row.sellerRevenue)),
});

export const getMySale = async ({ orderId }, { client, principal }) => {
  if (!orderId || typeof orderId !== "string" || orderId.length > 100) throw notFound();
  const row = await client.order.findFirst({
    where: buildSellerOrderWhere(principal.subject, { id: orderId }),
    select: saleDetailSelect,
  });
  if (!row) throw notFound();
  // Multi-seller groups: one matching sale line never authorizes the whole
  // checkout group — siblings are re-scoped to the same seller attribution,
  // and the page is bounded to the published 50-line contract.
  const groupRows = row.orderGroupId
    ? await client.order.findMany({
      where: buildSellerOrderWhere(principal.subject, { orderGroupId: row.orderGroupId, id: { not: row.id } }),
      select: saleSelect,
      take: MAX_LIMIT,
    })
    : [];
  // The stored ledger entry for this sale (created at confirmation, zeroed and
  // marked Refunded by the refund release). Scoped twice: app predicate here,
  // revenues RLS as the third layer.
  const revenue = await client.revenue.findFirst({
    where: { orderId: row.id, sellerId: principal.subject },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { status: true, totalSalePrice: true, adminCommission: true, sellerRevenue: true },
  });
  return {
    sale: {
      ...minimizeSale(row),
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
      revenue: revenue ? minimizeRevenue(revenue) : null,
    },
    groupSales: groupRows.map(minimizeSale),
  };
};

// Bucket windows use server-local months deliberately: the ledger's own
// month/year columns are written with local getMonth()/getFullYear() (see the
// order-confirmation revenue creation), so refund completion months must use
// the same convention to stay comparable.
const monthWindow = (year, month) => ({
  start: new Date(year, month - 1, 1),
  end: new Date(year, month, 1),
});

export const getMyRevenueSummary = async (
  { year } = {},
  { client, principal, now = new Date() },
) => {
  const resolvedYear = year ?? now.getFullYear();
  if (!Number.isInteger(resolvedYear) || resolvedYear < MIN_YEAR || resolvedYear > MAX_YEAR) {
    throw badInput("Year must be a whole number between 2000 and 2100");
  }
  // Ledger buckets: Completed rows only. Refund-released rows are zeroed in
  // the ledger, so including them would double-count nothing but quietly
  // blur semantics — excluded instead, and refunded money is read from the
  // refund records themselves.
  const revenueGroups = await client.revenue.groupBy({
    by: ["month"],
    where: { sellerId: principal.subject, year: resolvedYear, status: "Completed" },
    _sum: { totalSalePrice: true, adminCommission: true, sellerRevenue: true },
    _count: { _all: true },
  });
  const byMonth = new Map(
    revenueGroups
      .filter((group) => Number.isInteger(group.month) && group.month >= 1 && group.month <= 12)
      .map((group) => [group.month, group]),
  );
  // Refund buckets: succeeded refunds whose completion month falls in the
  // bucket. Refund money is attributed through the order's immutable
  // seller-at-purchase id and is never netted against the sale buckets — a
  // January sale refunded in March shows in January's gross and March's
  // refunded.
  const refundSums = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const { start, end } = monthWindow(resolvedYear, index + 1);
      const aggregate = await client.refund.aggregate({
        where: {
          status: "Succeeded",
          completedAt: { gte: start, lt: end },
          order: { sellerIdAtPurchase: principal.subject },
        },
        _sum: { amount: true },
      });
      return cents(aggregate?._sum?.amount);
    }),
  );

  const totals = { saleCount: 0, gross: 0, commission: 0, net: 0, refunded: 0 };
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const group = byMonth.get(month);
    const gross = cents(group?._sum?.totalSalePrice);
    const commission = cents(group?._sum?.adminCommission);
    const net = cents(group?._sum?.sellerRevenue);
    const refunded = refundSums[index];
    totals.saleCount += group?._count?._all ?? 0;
    totals.gross += gross;
    totals.commission += commission;
    totals.net += net;
    totals.refunded += refunded;
    return {
      month,
      saleCount: group?._count?._all ?? 0,
      grossSale: money(gross),
      commission: money(commission),
      netSale: money(net),
      refunded: money(refunded),
    };
  });
  return {
    year: resolvedYear,
    buckets,
    totals: {
      saleCount: totals.saleCount,
      grossSale: money(totals.gross),
      commission: money(totals.commission),
      netSale: money(totals.net),
      refunded: money(totals.refunded),
    },
  };
};
