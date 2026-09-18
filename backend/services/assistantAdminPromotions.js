// Admin promotion reads for issue #18.
// Two aggregate-only, read-only operations: a bounded configuration page and a
// per-code usage summary. Both are admin-only — the delegated token must carry
// the promotions:read scope, the route authorizes the admin role, row-level
// security keys the promo tables on the actor GUCs for the admin role and these
// exact operations, and the services re-check the principal as defense in
// depth (a non-admin gets the same generic not-found as a missing row).
// Configuration is disclosed as an allowlist: rule fields, counters, and the
// validity window. createdById (creator identity) and per-user redemption data
// (user ids, per-user rows, redemption timestamps) are never selected or
// emitted — the usage summary counts distinct redeemers through a groupBy and
// never reads usage rows back as rows. Money and percentages use exact decimal
// text parsed to integer paisa; no JavaScript floating point touches a value.
import { createCursorCodec } from "./assistantCursor.js";
import { centsToAmount, money, toCents } from "./assistantMoney.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// A percentage discount can never exceed 100% — toCents works in hundredths,
// so 100.00 is 10,000 cents.
const MAX_PERCENT_CENTS = 10_000;

const { decode: decodeCursor, encode: encodeCursor } = createCursorCodec({ operation: "promotions.listConfiguration" });

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });
// Stored configuration that violates the published contract (unknown discount
// type, out-of-range percentage, malformed decimal) fails closed instead of
// being clamped or silently reshaped.
const invalidConfiguration = () => new Error("Invalid promotion configuration");

const denyNonAdmin = (principal) => {
  // Same generic not-found a missing row produces: no existence leak, and the
  // RLS policies on the promo tables independently return no rows for
  // non-admin roles.
  if (!principal || principal.role !== "admin") throw notFound();
};

// Exactly the columns the projections read (plus the createdAt cursor key).
// createdById stays unselected; the usages table is never projected at all.
const promotionSelect = {
  id: true,
  code: true,
  discountType: true,
  discountValue: true,
  minPurchase: true,
  maxDiscount: true,
  usageLimit: true,
  usedCount: true,
  validFrom: true,
  validUntil: true,
  isActive: true,
  createdAt: true,
};

const discountCents = (value) => {
  const cents = toCents(value?.toString?.() ?? String(value));
  if (cents > MAX_PERCENT_CENTS) throw invalidConfiguration();
  return cents;
};

const minimizePromotion = (row) => ({
  promoCodeId: row.id,
  code: row.code?.slice(0, 50),
  discountType: row.discountType,
  // Percentage configs disclose an exact 0..100 percent; fixed configs
  // disclose the money amount in the store currency. The union keeps the two
  // representations structurally distinct.
  discountValue: row.discountType === "percentage"
    ? { percent: centsToAmount(discountCents(row.discountValue)) }
    : money(toCents(row.discountValue?.toString?.() ?? String(row.discountValue))),
  minPurchase: money(toCents(row.minPurchase?.toString?.() ?? String(row.minPurchase ?? 0))),
  maxDiscount: row.maxDiscount == null
    ? null
    : money(toCents(row.maxDiscount.toString())),
  usageLimit: row.usageLimit ?? null,
  usedCount: row.usedCount,
  validFrom: row.validFrom.toISOString(),
  validUntil: row.validUntil?.toISOString?.() ?? null,
  isActive: row.isActive,
});

export const listPromotionConfiguration = async (
  { cursor, limit = DEFAULT_LIMIT, activeOnly } = {},
  { client, principal, cursorSecret },
) => {
  denyNonAdmin(principal);
  if (limit !== undefined && limit !== null && !Number.isInteger(limit)) throw badInput("Invalid limit");
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const onlyActive = activeOnly === true;
  // The cursor fingerprint binds the activeOnly filter and page size, so a
  // cursor minted under one query never paginates another.
  const query = { activeOnly: onlyActive, limit: boundedLimit };
  const position = decodeCursor(cursor, principal, query, cursorSecret);
  const rows = await client.promoCode.findMany({
    where: {
      ...(onlyActive ? { isActive: true } : {}),
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    },
    select: promotionSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    promotions: page.map((row) => {
      if (row.discountType !== "percentage" && row.discountType !== "fixed") throw invalidConfiguration();
      return minimizePromotion(row);
    }),
    nextCursor: rows.length > boundedLimit
      ? encodeCursor(page.at(-1), principal, query, cursorSecret)
      : null,
  };
};

export const getPromotionUsageSummary = async (
  { promoCodeId } = {},
  { client, principal },
) => {
  denyNonAdmin(principal);
  if (!promoCodeId || typeof promoCodeId !== "string" || promoCodeId.length > 100) throw notFound();
  // Missing and out-of-scope ids resolve to the same generic not-found: the
  // RLS policy returns no rows for anything this operation may not read.
  const promo = await client.promoCode.findFirst({
    where: { id: promoCodeId },
    select: {
      id: true,
      code: true,
      usedCount: true,
      isActive: true,
      validFrom: true,
      validUntil: true,
    },
  });
  if (!promo) throw notFound();
  // Aggregate-only: one group per distinct redeemer. The per-user rows are
  // counted, never returned — findMany/findFirst on promo_code_usages is
  // deliberately absent, and the column grant backs only these two columns.
  const redeemerGroups = await client.promoCodeUsage.groupBy({
    by: ["userId"],
    where: { promoCodeId: promo.id },
  });
  return {
    promoCodeId: promo.id,
    code: promo.code?.slice(0, 50),
    totalRedemptions: promo.usedCount,
    distinctUsers: redeemerGroups.length,
    active: promo.isActive,
    validFrom: promo.validFrom.toISOString(),
    validUntil: promo.validUntil?.toISOString?.() ?? null,
  };
};
