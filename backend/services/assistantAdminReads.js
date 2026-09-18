// Admin platform aggregates and minimized seller-application reads for #16.
// Both operations are admin-only and read fixed bounded projections: the
// platform revenue summary aggregates the append-only revenues ledger (never
// emitting a raw ledger, order, payment-event, bank, or customer row), and the
// seller-application list exposes only approved business/display metadata and
// the application status derived from the verification fields on User.
// Identity evidence and private contacts (email, phone, names, home address)
// are never selected and never leave the first-party UI.
//
// Every amount is parsed to integer minor units (paisa) and formatted back via
// services/assistantMoney.js — no JavaScript floating point ever touches a
// total, and refunded money is never netted against the gross buckets.
import crypto from "node:crypto";

import { createCursorCodec } from "./assistantCursor.js";
import { money, toCents } from "./assistantMoney.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_SHOP_NAME = 200;
const MAX_SHOP_DESCRIPTION = 2000;
const MAX_REJECTION_REASON = 500;

const { decode: decodeApplicationCursor, encode: encodeApplicationCursor } = createCursorCodec({
  operation: "sellers.listApplications",
});

const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Platform revenue summary authorization is enforced twice: the Express route
// admits only delegated tokens carrying platform:read whose live account role
// is admin, and the revenues/refunds RLS policies admit only rows presented
// under actor_role 'admin' with operation platform.revenueSummary. The
// principal check here is defense in depth for direct service callers.
const assertAdminPrincipal = (principal) => {
  if (principal?.role !== "admin") {
    throw Object.assign(new Error("Administrator access required"), { statusCode: 403, code: "role_not_allowed" });
  }
};

const cents = (value) => (value == null ? 0 : toCents(value.toString?.() ?? String(value)));

// Bucket windows use server-local months deliberately: the ledger's own
// month/year columns are written with local getMonth()/getFullYear() (see the
// order-confirmation revenue creation), so refund completion months must use
// the same convention to stay comparable.
const monthWindow = (year, month) => ({
  start: new Date(year, month - 1, 1),
  end: new Date(year, month, 1),
});

export const getPlatformRevenueSummary = async (
  { year } = {},
  { client, principal, now = new Date() },
) => {
  assertAdminPrincipal(principal);
  const resolvedYear = year ?? now.getFullYear();
  if (!Number.isInteger(resolvedYear) || resolvedYear < MIN_YEAR || resolvedYear > MAX_YEAR) {
    throw badInput("Year must be a whole number between 2000 and 2100");
  }
  // Ledger buckets: Completed rows only. Refund-released rows are zeroed in
  // the ledger, so including them would blur semantics — excluded instead, and
  // refunded money is read from the refund records themselves. A January sale
  // refunded in March therefore stays in January's gross and appears in
  // March's refunded — never netted against the sale buckets.
  const revenueGroups = await client.revenue.groupBy({
    by: ["month"],
    where: { year: resolvedYear, status: "Completed" },
    _sum: { totalSalePrice: true, adminCommission: true, sellerRevenue: true },
    _count: { _all: true },
  });
  const byMonth = new Map(
    revenueGroups
      .filter((group) => Number.isInteger(group.month) && group.month >= 1 && group.month <= 12)
      .map((group) => [group.month, group]),
  );
  // Refund buckets: succeeded refunds whose completion month falls in the
  // bucket, aggregated platform-wide (no per-seller attribution exists at this
  // level and none is emitted).
  const refundSums = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const { start, end } = monthWindow(resolvedYear, index + 1);
      const aggregate = await client.refund.aggregate({
        where: {
          status: "Succeeded",
          completedAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
      });
      return cents(aggregate?._sum?.amount);
    }),
  );

  const totals = { completedSaleCount: 0, gross: 0, commission: 0, seller: 0, refunded: 0 };
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const group = byMonth.get(month);
    const gross = cents(group?._sum?.totalSalePrice);
    const commission = cents(group?._sum?.adminCommission);
    const seller = cents(group?._sum?.sellerRevenue);
    const refunded = refundSums[index];
    totals.completedSaleCount += group?._count?._all ?? 0;
    totals.gross += gross;
    totals.commission += commission;
    totals.seller += seller;
    totals.refunded += refunded;
    return {
      month,
      completedSaleCount: group?._count?._all ?? 0,
      grossSale: money(gross),
      adminCommission: money(commission),
      sellerRevenue: money(seller),
      refunded: money(refunded),
    };
  });
  return {
    year: resolvedYear,
    buckets,
    totals: {
      completedSaleCount: totals.completedSaleCount,
      grossSale: money(totals.gross),
      adminCommission: money(totals.commission),
      sellerRevenue: money(totals.seller),
      refunded: money(totals.refunded),
    },
  };
};

// Seller-application state lives on User (there is no SellerApplication model):
// register-as-seller sets role 'seller' + isVerified false + request date,
// approval sets isVerified true (+ approved date), rejection records the
// reason. Current verified state wins over a stale rejection reason.
const applicationStatus = (row) => {
  if (row.isVerified) return "approved";
  if (row.verificationRejectionReason) return "rejected";
  return "pending";
};

const APPLICATION_STATUSES = Object.freeze(["pending", "approved", "rejected"]);

const statusWhere = (status) => {
  if (status === "approved") return { isVerified: true };
  if (status === "rejected") return { isVerified: false, verificationRejectionReason: { not: null } };
  if (status === "pending") return { isVerified: false, verificationRejectionReason: null };
  return {};
};

// Opaque, stable seller reference: the same deterministic digest pattern the
// buyer reads use, keyed to the seller's account id. It lets an admin correlate
// applications without disclosing names, emails, phone numbers, or raw ids.
const sellerReference = (userId) => (userId
  ? `seller-${crypto.createHash("sha256").update(`shopsphere-seller:${userId}`).digest("hex").slice(0, 12)}`
  : null);

// Hand-written projection: only the application columns the minimized summary
// exposes (plus the cursor/order keys). Email, phone, names, password fields,
// reset tokens, and home-address columns are absent by construction.
const applicationSelect = {
  id: true,
  shopName: true,
  shopDescription: true,
  isVerified: true,
  verificationRequestDate: true,
  verificationApprovedDate: true,
  verificationRejectionReason: true,
  createdAt: true,
};

const minimizeApplication = (row) => {
  const status = applicationStatus(row);
  return {
    sellerReference: sellerReference(row.id),
    shopName: row.shopName?.slice?.(0, MAX_SHOP_NAME) ?? "",
    shopDescription: row.shopDescription?.slice?.(0, MAX_SHOP_DESCRIPTION) ?? "",
    status,
    requestDate: row.verificationRequestDate?.toISOString?.() ?? null,
    decisionDate: status === "approved" ? row.verificationApprovedDate?.toISOString?.() ?? null : null,
    rejectionReason: status === "rejected"
      ? row.verificationRejectionReason?.slice?.(0, MAX_REJECTION_REASON) ?? null
      : null,
  };
};

export const listSellerApplications = async (
  { status, cursor, limit = DEFAULT_LIMIT } = {},
  { client, principal, cursorSecret },
) => {
  assertAdminPrincipal(principal);
  if (status !== undefined && !APPLICATION_STATUSES.includes(status)) {
    throw badInput(`Unknown application status: ${status}`);
  }
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const query = { status: status ?? null, limit: boundedLimit };
  const position = decodeApplicationCursor(cursor, principal, query, cursorSecret);
  const rows = await client.user.findMany({
    where: {
      role: "seller",
      ...statusWhere(status),
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    },
    select: applicationSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    applications: page.map(minimizeApplication),
    nextCursor: rows.length > boundedLimit
      ? encodeApplicationCursor(page.at(-1), principal, query, cursorSecret)
      : null,
  };
};
