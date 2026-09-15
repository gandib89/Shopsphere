// Buyer cart reads for issue #12.
// Every query scopes to the authenticated buyer (Cart.userId = subject) and
// projects only current visible product and pricing fields. Totals use exact
// server arithmetic from validated option pricing; there is deliberately no
// input field for caller-supplied totals. All three operations are reads:
// they never create or change orders, bills, reservations, payments, gateway
// forms, notifications, emails, or promo usage counters.
import { money, percentOffCents, toCents, toSignedCents } from "./assistantMoney.js";

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });

const cartSelect = {
  id: true,
  items: {
    select: {
      productId: true,
      quantity: true,
      variants: true,
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          images: true,
          category: true,
          discount: true,
          quantity: true,
          isArchived: true,
          options: { select: { kind: true, value: true, priceDelta: true } },
        },
      },
    },
  },
};

const sanitizeVariants = (variants) => {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return {};
  const entries = Object.entries(variants).slice(0, 10);
  const clean = {};
  for (const [kind, value] of entries) {
    if (typeof kind !== "string" || typeof value !== "string") continue;
    if (!kind || kind.length > 50 || !value || value.length > 100) continue;
    clean[kind] = value;
  }
  return clean;
};

// Server-derived line price: base price plus validated option deltas. Unknown
// variant selections contribute nothing, so a forged variants map cannot move
// the total.
const listUnitCents = (product, variants) => {
  const base = toCents(product.price);
  const options = Array.isArray(product.options) ? product.options : [];
  let delta = 0;
  for (const [kind, value] of Object.entries(variants)) {
    const option = options.find((candidate) => candidate.kind === kind && candidate.value === value);
    if (option) delta += toSignedCents(option.priceDelta ?? "0");
  }
  return Math.max(0, base + delta);
};

const buildItems = (rows) => {
  let subtotalCents = 0;
  let totalCents = 0;
  const items = (rows ?? []).map((row) => {
    const variants = sanitizeVariants(row.variants);
    const product = row.product;
    if (!product || product.isArchived) {
      return {
        productId: row.productId,
        name: product?.name?.slice?.(0, 200) ?? "Unavailable product",
        quantity: row.quantity,
        unitPrice: money(0),
        lineTotal: money(0),
        variants,
        images: [],
        availability: "Unavailable",
      };
    }
    const listUnit = listUnitCents(product, variants);
    const unit = percentOffCents(listUnit, product.discount ?? 0);
    const line = unit * row.quantity;
    subtotalCents += listUnit * row.quantity;
    totalCents += line;
    return {
      productId: product.id,
      name: String(product.name).slice(0, 200),
      quantity: row.quantity,
      unitPrice: money(unit),
      lineTotal: money(line),
      variants,
      images: Array.isArray(product.images) ? product.images.slice(0, 5) : [],
      availability: (product.quantity ?? 0) > 0 ? "In stock" : "Sold out",
    };
  });
  return { items, subtotalCents, totalCents };
};

export const getMyCart = async (_input, { client, principal }) => {
  const cart = await client.cart.findFirst({ where: { userId: principal.subject }, select: cartSelect });
  const { items, subtotalCents, totalCents } = buildItems(cart?.items);
  return {
    items,
    subtotal: money(subtotalCents),
    discountTotal: money(subtotalCents - totalCents),
    total: money(totalCents),
  };
};

const normalizeCode = (code) => (typeof code === "string" ? code.trim().toUpperCase() : "");

const invalidPromo = (reason) => ({
  code: null,
  valid: false,
  reason,
  discountType: null,
  discountValue: null,
  discountAmount: money(0),
  finalAmount: null,
});

// Pure promo evaluation over already-fetched rows. Split from the database
// reads so tests can prove no write path exists: this function receives data
// and returns a decision, never touching commerce state.
const evaluatePromo = ({ code, promo, used, purchaseCents, now }) => {
  if (!promo) return invalidPromo("invalid");
  if (!promo.isActive) return { ...invalidPromo("inactive"), code: promo.code };
  if (now < new Date(promo.validFrom)) return { ...invalidPromo("not_yet_valid"), code: promo.code };
  if (now > new Date(promo.validUntil)) return { ...invalidPromo("expired"), code: promo.code };
  if (used) return { ...invalidPromo("already_used"), code: promo.code };
  if (promo.usageLimit != null && Number(promo.usedCount ?? 0) >= Number(promo.usageLimit)) {
    return { ...invalidPromo("usage_limit"), code: promo.code };
  }
  const minPurchaseCents = toCents(promo.minPurchase ?? "0");
  if (purchaseCents < minPurchaseCents) return { ...invalidPromo("min_purchase"), code: promo.code };
  let discountCents;
  if (promo.discountType === "percentage") {
    // Integer basis-point arithmetic: "10" -> 1000bps, half-up rounding, no
    // binary float. Corrupt >100% rows clamp to the purchase (fail closed).
    const basisPoints = Math.min(toCents(String(promo.discountValue)), 10_000);
    discountCents = Math.floor((purchaseCents * basisPoints + 5_000) / 10_000);
    const cap = promo.maxDiscount != null ? toCents(promo.maxDiscount) : null;
    if (cap != null) discountCents = Math.min(discountCents, cap);
  } else {
    discountCents = Math.min(toCents(promo.discountValue), purchaseCents);
  }
  return {
    code: promo.code,
    valid: true,
    reason: null,
    discountType: promo.discountType,
    discountValue: String(promo.discountValue),
    discountAmount: money(discountCents),
    finalAmount: money(purchaseCents - discountCents),
  };
};

const promoSelect = {
  id: true,
  code: true,
  description: true,
  discountType: true,
  discountValue: true,
  minPurchase: true,
  maxDiscount: true,
  usageLimit: true,
  usedCount: true,
  validFrom: true,
  validUntil: true,
  isActive: true,
};

export const validatePromoCode = async ({ code }, { client, principal, now = new Date() }) => {
  const normalized = normalizeCode(code);
  if (!normalized || normalized.length > 50) throw notFound();
  // Read-only by construction: findUnique twice, no usage increment, no
  // PromoCodeUsage write, no notification. The readOnlyClient test proxy
  // rejects any non-find call if a write path is ever added.
  const promo = await client.promoCode.findUnique({ where: { code: normalized }, select: promoSelect });
  const cart = await client.cart.findFirst({ where: { userId: principal.subject }, select: cartSelect });
  const { totalCents } = buildItems(cart?.items);
  const used = promo
    ? await client.promoCodeUsage.findUnique({
      where: { promoCodeId_userId: { promoCodeId: promo.id, userId: principal.subject } },
    })
    : null;
  return evaluatePromo({ code: normalized, promo, used, purchaseCents: totalCents, now });
};

export const previewCheckout = async ({ promoCode } = {}, { client, principal, now = new Date() }) => {
  // Pure preview: the cart is re-read and totals recomputed on the server. No
  // order, bill, reservation, payment, gateway form, notification, or email is
  // created; promo usage is validated, never consumed.
  const cart = await client.cart.findFirst({ where: { userId: principal.subject }, select: cartSelect });
  const { items, subtotalCents, totalCents } = buildItems(cart?.items);
  let promo = null;
  let promoDiscountCents = 0;
  if (promoCode !== undefined && promoCode !== null && String(promoCode).trim() !== "") {
    const normalized = normalizeCode(promoCode);
    const row = await client.promoCode.findUnique({ where: { code: normalized }, select: promoSelect });
    const used = row
      ? await client.promoCodeUsage.findUnique({
        where: { promoCodeId_userId: { promoCodeId: row.id, userId: principal.subject } },
      })
      : null;
    const evaluated = evaluatePromo({ code: normalized, promo: row, used, purchaseCents: totalCents, now });
    promo = evaluated.valid
      ? {
        code: evaluated.code,
        discountType: evaluated.discountType,
        discountValue: evaluated.discountValue,
        discountAmount: evaluated.discountAmount,
      }
      : { code: evaluated.code, valid: false, reason: evaluated.reason };
    promoDiscountCents = evaluated.valid ? toCents(evaluated.discountAmount.amount) : 0;
  }
  return {
    items,
    subtotal: money(subtotalCents),
    discountTotal: money(subtotalCents - totalCents),
    promo,
    promoDiscount: money(promoDiscountCents),
    total: money(totalCents - promoDiscountCents),
  };
};
