// Seller price/discount proposals for issue #27, on the #22 proposal platform
// (extended by #24/#25).
//
// proposePriceChange persists ONLY a proposal row (plus one "created" outbox
// event, exactly like every other proposal class): it never mutates the live
// product price or discount, never touches orders, payments, refunds, revenue,
// bills, promotions, notifications, or emails, and never calls any provider.
// The buyer-facing display math is unaffected at creation time.
//
// Scope: PRODUCT-level price/discount only. Options carry additive priceDelta
// deltas, not absolute prices, so an optionId target would not fit the
// "exact old/new absolute value" contract — the strict input schema therefore
// has no optionId field at all and rejects it with 400 (documented in the
// registry and route comments).
//
// Configured bounds (server-side constants here — nothing configurable exists
// elsewhere in the codebase, so the proposal contract defines them):
//   - set_price:     new price within [1.00, 999999.99] NPR (Decimal(12,2))
//   - set_discount:  new discount within [0, 100] percent (Decimal(5,2))
//   - exactly one change per proposal (one `change` field in the input)
//   - the new value must differ from the current value (checked against the
//     live product row, re-checked at execution)
//
// Error semantics: a foreign or missing productId is the identical generic
// 404 via the present-day sellerId ownership predicate (never an existence
// leak). An owned product whose requested value violates a bound or repeats
// the current value creates NO proposal and fails with a deterministic 400.
// Seller verification is enforced by the route-scoped
// requireVerifiedSeller gate (services/assistantVerifiedSellerPriceGate.js) —
// that single enforcement point is deliberate and documented there.
//
// Version semantics: products had no mutation marker, so migration
// 20260919220000_product_updated_at added products."updatedAt" (Prisma
// @updatedAt). expectedVersion stores Math.floor(updatedAt.getTime() / 1000) —
// epoch SECONDS, because proposals."expectedVersion" is an int4 column and
// epoch milliseconds overflow it (same proxy convention as orderVersionOf for
// #24/#25). Propose and execution derive it with this same productVersionOf
// helper, so any committed product change after the preview makes the proposal
// stale at execution; same-second collisions are covered by re-checking the
// bounds against fresh state and claiming the row with an updatedAt-conditional
// update at execution.
//
// All propose-side operations run inside withAssistantActor as
// shopsphere_assistant_private_runtime: the RLS policies key rows on the actor
// GUCs (proposals + the seller products policy admit 'proposals.priceChange'),
// so the subject scoping below is defense in depth, not the only gate.
import crypto from "node:crypto";

import { centsToAmount, money, percentOffCents, toCents } from "./assistantMoney.js";
import { generateId } from "../utils/generateId.js";
import { PROPOSAL_TTL_MS } from "./assistantProposals.js";

export const SET_PRICE_ACTION_KIND = "product.set_price";
export const SET_DISCOUNT_ACTION_KIND = "product.set_discount";

export const PRICE_ACTION_KINDS = Object.freeze([SET_PRICE_ACTION_KIND, SET_DISCOUNT_ACTION_KIND]);

// Configured bounds in exact integer paisa / percent-hundredths.
export const MIN_PRICE_CENTS = 100; // 1.00 NPR
export const MAX_PRICE_CENTS = 99_999_999; // 999999.99 NPR (Decimal(12,2) max)
export const MIN_DISCOUNT_HUNDREDTHS = 0; // 0%
export const MAX_DISCOUNT_HUNDREDTHS = 10_000; // 100%

const PRICE_VALUE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const PERCENT_VALUE_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

export const actionKindFor = (change) =>
  change === "set_price" ? SET_PRICE_ACTION_KIND : change === "set_discount" ? SET_DISCOUNT_ACTION_KIND : null;

// Optimistic-concurrency proxy for products, which had no version column —
// the exact analogue of orderVersionOf for orders. expectedVersion stores the
// product row's updatedAt as epoch SECONDS (int4-safe). Propose and execution
// derive it with this same helper.
export const productVersionOf = (product) => {
  const updatedAt = product?.updatedAt instanceof Date ? product.updatedAt : new Date(product?.updatedAt);
  const ms = updatedAt.getTime();
  if (Number.isNaN(ms)) throw Object.assign(new Error("Product has no usable updatedAt"), { statusCode: 500 });
  return Math.floor(ms / 1000);
};

// Parses a caller-supplied new value for one change against the configured
// bounds. Returns exact integer hundredths, or null when malformed or out of
// bounds (negatives, >2 decimals, and non-decimals fail the patterns; the
// bounds check pins the range).
export const parsePriceChangeValue = (change, newValue) => {
  if (change === "set_price") {
    if (typeof newValue !== "string" || !PRICE_VALUE_PATTERN.test(newValue)) return null;
    let cents;
    try {
      cents = toCents(newValue);
    } catch {
      return null;
    }
    return cents >= MIN_PRICE_CENTS && cents <= MAX_PRICE_CENTS ? { cents } : null;
  }
  if (change === "set_discount") {
    if (typeof newValue !== "string" || !PERCENT_VALUE_PATTERN.test(newValue)) return null;
    let hundredths;
    try {
      hundredths = toCents(newValue);
    } catch {
      return null;
    }
    return hundredths >= MIN_DISCOUNT_HUNDREDTHS && hundredths <= MAX_DISCOUNT_HUNDREDTHS
      ? { cents: hundredths }
      : null;
  }
  return null;
};

const currentHundredthsOf = (change, product) => {
  const raw = change === "set_price" ? product.price : product.discount;
  try {
    return toCents(raw?.toString?.() ?? String(raw ?? "0"));
  } catch {
    return null;
  }
};

// Shared business-rule check used by BOTH proposal creation and first-party
// execution: returns null when the stored change is applicable to the given
// product state, otherwise a fixed reason string. Bounds first, then the
// unchanged-value rule (both against the CURRENT row, so a value that was
// valid at propose time but collided with the current state at execution is
// rejected, never silently applied).
export const priceChangeRejectionFor = ({ change, newValue }, product) => {
  if (change !== "set_price" && change !== "set_discount") return "out_of_bounds";
  const parsed = parsePriceChangeValue(change, newValue);
  if (!parsed) return "out_of_bounds";
  const current = currentHundredthsOf(change, product);
  if (current === null) return "out_of_bounds";
  if (parsed.cents === current) return "unchanged";
  return null;
};

// The exact column payload for the one apply-update. set_discount also stamps
// discountUpdatedAt, mirroring the storefront discount paths.
export const priceUpdateDataFor = (change, newValue, now) =>
  change === "set_price"
    ? { price: newValue }
    : { discount: newValue, discountUpdatedAt: now };

// Exact display price in integer paisa: list price with the discount percent
// applied via the integer math of assistantMoney.percentOffCents — the same
// helper the cart proposal platform uses and the exact-decimal form of
// utils/productPricing.js effectiveProductPrice's formula
// (price × (1 − discount/100), rounded half-up to 2 decimals).
const effectiveDisplayCents = (priceCents, discountRaw) =>
  percentOffCents(priceCents, discountRaw?.toString?.() ?? String(discountRaw ?? "0"));

const disclosedConsequencesFor = (change, oldValue, newValue) =>
  change === "set_price"
    ? Object.freeze([
        `Changes the live listing price from ${oldValue} to ${newValue} NPR`,
        "No orders, payments, or promotions are affected",
      ])
    : Object.freeze([
        `Changes the discount percentage from ${oldValue}% to ${newValue}%`,
        "No orders, payments, or promotions are affected",
      ]);

const productSelect = {
  id: true,
  name: true,
  price: true,
  discount: true,
  sellerId: true,
  updatedAt: true,
};

export const proposePriceChange = async (input, { client, principal, now = new Date() }) => {
  const productId = input?.productId;
  if (typeof productId !== "string" || productId.length === 0 || productId.length > 100) throw notFound();
  const change = input?.change;
  if (change !== "set_price" && change !== "set_discount") throw badInput("Invalid price change");

  // Read-only owned-product load through the present-day sellerId predicate
  // only (never a storefront fallback, never historical attribution). A
  // foreign or missing id resolves to null here and produces the identical
  // generic 404 — no existence leak.
  const product = await client.product.findFirst({
    where: { id: productId, sellerId: principal.subject },
    select: productSelect,
  });
  if (!product) throw notFound();

  // Bounds + unchanged-value rules (documented above). An out-of-bounds or
  // no-op change is a deterministic 400 — no proposal row, no outbox event,
  // no side effect of any kind.
  const rejection = priceChangeRejectionFor(input, product);
  if (rejection === "out_of_bounds") throw badInput("Requested value is outside the configured bounds");
  if (rejection === "unchanged") throw badInput("The new value equals the current value");

  const parsed = parsePriceChangeValue(change, input.newValue);
  // Canonical exact-decimal strings (trailing zeros normalized), so the stored
  // preview/payload can never carry a non-canonical form of the same value.
  const newValue = centsToAmount(parsed.cents);
  const isPrice = change === "set_price";
  const currentRaw = isPrice ? product.price : product.discount;
  const currentValue = currentHundredthsOf(change, product);
  const oldValue = centsToAmount(currentValue);

  const priceCents = toCents(product.price?.toString?.() ?? String(product.price));
  // set_price changes the list price under the CURRENT discount; set_discount
  // changes the discount under the CURRENT list price.
  const discountRaw = product.discount?.toString?.() ?? String(product.discount ?? "0");
  const preview = {
    actionKind: actionKindFor(change),
    currency: "NPR",
    productId: product.id,
    productName: String(product.name).slice(0, 200),
    change,
    oldValue,
    newValue,
    effectiveDisplayPriceBefore: money(effectiveDisplayCents(priceCents, discountRaw)),
    effectiveDisplayPriceAfter: money(
      isPrice
        ? effectiveDisplayCents(parsed.cents, discountRaw)
        : effectiveDisplayCents(priceCents, input.newValue),
    ),
    disclosedConsequences: [...disclosedConsequencesFor(change, oldValue, newValue)],
  };

  const canonicalPayload = { productId: product.id, change, newValue };
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  const id = generateId();

  await client.proposal.create({
    data: {
      id,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind: actionKindFor(change),
      targetType: "product",
      targetId: product.id,
      canonicalPayload,
      preview,
      expectedVersion: productVersionOf(product),
      payloadHash,
      status: "pending",
      expiresAt,
    },
  });
  // Same-transaction outcome record. Append-only at the database level.
  await client.proposalOutboxEvent.create({
    data: { id: crypto.randomUUID(), proposalId: id, eventType: "created", payloadHash },
  });

  return {
    proposalId: id,
    status: "pending",
    expiresAt: expiresAt.toISOString(),
    preview,
  };
};
