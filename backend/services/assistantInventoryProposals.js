// Seller inventory proposals for issue #28, on the #22 proposal platform
// (extended by #24/#25/#26/#27).
//
// proposeInventoryAdjustment persists ONLY a proposal row (plus one "created"
// outbox event, exactly like every other proposal class): it never writes
// Product.quantity or ProductOption.stock, never reserves stock, never creates
// or mutates an order, never flips availability, and never writes a
// notification or sends an email. The live stock mutation happens exclusively
// through the first-party browser execution endpoint
// (routes/proposalExecutionRoute.js), which revalidates everything and applies
// one conditional compare-and-swap write.
//
// Target contract: exactly ONE stock counter per proposal.
//   - optionId given   ⇒ that option must track its own stock (stock != null).
//     An option with stock == null does NOT track inventory (the product-level
//     quantity governs it, mirroring the #22 cart platform's option-aware
//     availability rule) and is refused with a deterministic 400.
//   - no optionId      ⇒ the product-level quantity, allowed ONLY when no
//     option of the product tracks its own stock — otherwise the target would
//     be ambiguous, so the proposal is refused with 400 (documented as
//     "option_required": target one option per proposal instead).
//
// Input contract: exactly one of
//   - adjustment: a signed relative change in [-10000, 10000], or
//   - setTo:      an absolute count in [0, 100000],
// plus a REQUIRED user-authored reason (20..500 characters, free text). The
// reason is stored in the canonical payload and preview so the human reviewer
// sees it, but it is projected OUT of every durable audit row by the route's
// auditInput — audits keep only productId/optionId and the change numbers.
// There is NO confirm/execute field and no other overwrite semantics: forged
// fields fail the strict schema, not the stock.
//
// Error semantics: a foreign or missing product, and a foreign or missing
// optionId inside an owned product, are the IDENTICAL generic 404 (no
// existence leak) via the present-day sellerId ownership predicate — the same
// predicate the seller catalog (#12/#14) and #26/#27 proposals use. Verification
// gating is NOT in this service: the routes attach requireVerifiedSeller()
// (services/assistantVerifiedSellerGate.js) after authorization, so only a
// currently verified seller reaches this code.
//
// Concurrency design (defense in depth, two independent checks):
//   1. Version proxy — ProductOption carries no updatedAt, so the PARENT
//      product's updatedAt (epoch SECONDS, int4-safe — the exact convention of
//      assistantPriceProposals.productVersionOf, reused here) is the
//      expectedVersion. Any committed product mutation (price, content, stock,
//      storefront flows that rewrite the product) after the preview makes the
//      proposal stale at execution. Limitation, documented: same-second option
//      edits that touch no product column do not move the proxy alone.
//   2. Exact before-value equality — the proposal also stores the exact
//      previewed currentCount, and execution requires the CURRENT count to
//      still equal it. A sale or any inventory change after the preview
//      changes the targeted count, so the proposal goes stale — it can never
//      overwrite a concurrent sale. The final apply is additionally a
//      conditional update (WHERE stock/quantity = currentCount) inside the
//      claim transaction, so even a write landing in the read-to-write window
//      counts 0 rows, rolls everything back, and retries deterministically.
//   3. Nonnegative result — the requested count is computed from the CURRENT
//      count at both propose time (400) and execution time (rejected 409); the
//      platform can never produce negative stock.
//
// All propose-side operations run inside withAssistantActor as
// shopsphere_assistant_private_runtime: the RLS policies key rows on the actor
// GUCs (proposals + the seller products/options policies admit
// 'proposals.inventoryAdjust'), so the subject scoping below is defense in
// depth, not the only gate.
import crypto from "node:crypto";

import { z } from "zod";

import { generateId } from "../utils/generateId.js";
import { PROPOSAL_TTL_MS, canonicalPayloadHash } from "./assistantProposals.js";
import { productVersionOf } from "./assistantPriceProposals.js";

export const INVENTORY_ADJUST_ACTION_KIND = "inventory.adjust";

// Configured bounds (server-side constants — nothing configurable exists
// elsewhere in the codebase, so the proposal contract defines them, exactly
// like the #27 price bounds).
export const MIN_ADJUSTMENT = -10_000;
export const MAX_ADJUSTMENT = 10_000;
export const MIN_SET_TO = 0;
export const MAX_SET_TO = 100_000;

// The reason is REQUIRED user-authored free text.
export const REASON_MIN = 20;
export const REASON_MAX = 500;

// Display bounds for preview fields (assistant projections never emit raw
// unbounded strings).
const PRODUCT_NAME_MAX = 200;
const OPTION_KIND_MAX = 100;
const OPTION_VALUE_MAX = 200;
// The disclosure string interpolates the target label; bounded so the fixed
// disclosure template always fits the registry's 300-character contract.
const DISCLOSURE_NAME_MAX = 100;
const DISCLOSURE_KIND_MAX = 40;
const DISCLOSURE_VALUE_MAX = 60;

// Strict input schema. Exported so the route and the tests exercise the
// identical object: the closed field set is the allowlist enforcement — no
// confirm/execute/approved affordance, no absolute `stock` overwrite field,
// no caller-supplied identity, and no second change kind can parse. The
// superRefine enforces "exactly one of adjustment/setTo" (both, or neither,
// fail).
export const proposeInventoryAdjustmentInputSchema = z
  .object({
    productId: z.string().min(1).max(100),
    optionId: z.string().min(1).max(100).optional(),
    adjustment: z.number().int().min(MIN_ADJUSTMENT).max(MAX_ADJUSTMENT).optional(),
    setTo: z.number().int().min(MIN_SET_TO).max(MAX_SET_TO).optional(),
    reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    const given = (value.adjustment !== undefined ? 1 : 0) + (value.setTo !== undefined ? 1 : 0);
    if (given !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adjustment"],
        message: "exactly one of adjustment or setTo is required",
      });
    }
  });

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Resolves the single stock counter a proposal targets, from a loaded owned
// product row that includes its options. Returns { ok: true, currentCount,
// option } on success, or { ok: false, code } with one of:
//   "missing"            — the optionId does not resolve inside this product
//   "option_not_tracked" — the option exists but stock is null (the
//                          product-level quantity governs it)
//   "option_required"    — product-level target, but some option of this
//                          product tracks its own stock, so the target would
//                          be ambiguous
// Used identically by proposal creation (404/400) and first-party execution
// (rejected), so both sides can never disagree about target semantics.
export const resolveInventoryTarget = (product, optionId) => {
  const options = Array.isArray(product?.options) ? product.options : [];
  if (optionId !== null && optionId !== undefined) {
    const option = options.find((candidate) => candidate.id === optionId);
    if (!option) return { ok: false, code: "missing" };
    if (option.stock === null || option.stock === undefined) return { ok: false, code: "option_not_tracked" };
    return { ok: true, currentCount: option.stock, option };
  }
  if (options.some((candidate) => candidate.stock !== null && candidate.stock !== undefined)) {
    return { ok: false, code: "option_required" };
  }
  return { ok: true, currentCount: product.quantity, option: null };
};

// The requested absolute count, computed from the CURRENT count: setTo is
// absolute, adjustment is relative. Exported because execution recomputes it
// from fresh state with this same helper (never negative — see
// inventoryAdjustmentRejectionFor).
export const requestedCountFor = (change, currentCount) =>
  change.setTo !== undefined && change.setTo !== null
    ? change.setTo
    : currentCount + (change.adjustment ?? 0);

// Shared business-rule check used by BOTH proposal creation and first-party
// execution: returns null when the stored change is applicable to the given
// current count, otherwise a fixed reason string. Bounds first, then the
// nonnegative-result rule against the CURRENT count (so a change that was
// valid at propose time but collided with a concurrent sale at execution is
// rejected, never silently applied and never negative).
export const inventoryAdjustmentRejectionFor = (change, currentCount) => {
  const hasAdjustment = change.adjustment !== undefined && change.adjustment !== null;
  const hasSetTo = change.setTo !== undefined && change.setTo !== null;
  if (hasAdjustment === hasSetTo) return "invalid_change";
  if (hasAdjustment) {
    if (!Number.isInteger(change.adjustment) || change.adjustment < MIN_ADJUSTMENT || change.adjustment > MAX_ADJUSTMENT) {
      return "out_of_bounds";
    }
  } else if (!Number.isInteger(change.setTo) || change.setTo < MIN_SET_TO || change.setTo > MAX_SET_TO) {
    return "out_of_bounds";
  }
  const requested = requestedCountFor(change, currentCount);
  if (!Number.isInteger(requested) || requested < 0) return "negative_result";
  return null;
};

// Fixed disclosure strings shown to the reviewer. The first interpolates ONLY
// stored, bounded values (target label, exact counts); the other two are
// constants shared with the review screen, so the review can never tell a
// different story than the preview.
export const inventoryDisclosuresFor = (targetLabel, currentCount, requestedCount) => [
  `Sets stock for ${targetLabel} from ${currentCount} to ${requestedCount} on confirm`,
  "Concurrent sales between review and confirm make this proposal stale",
  "No orders or notifications are affected",
];

const optionLabelOf = (productName, option) =>
  `"${productName.slice(0, DISCLOSURE_NAME_MAX)}" (${String(option.kind).slice(0, DISCLOSURE_KIND_MAX)}: ${String(option.value).slice(0, DISCLOSURE_VALUE_MAX)})`;

export const proposeInventoryAdjustment = async (input, { client, principal, now = new Date() }) => {
  const productId = input?.productId;
  if (typeof productId !== "string" || productId.length === 0 || productId.length > 100) throw notFound();

  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw badInput("a reason of 20-500 characters is required");
  }

  const optionId = input?.optionId;
  if (optionId !== undefined && (typeof optionId !== "string" || optionId.length === 0 || optionId.length > 100)) {
    throw badInput("invalid optionId");
  }

  // Read-only owned-product load through the present-day sellerId predicate
  // only (never a storefront fallback, never historical attribution). A
  // foreign or missing id resolves to null here and produces the identical
  // generic 404 — no existence leak.
  const product = await client.product.findFirst({
    where: { id: productId, sellerId: principal.subject },
    select: {
      id: true,
      name: true,
      quantity: true,
      sellerId: true,
      updatedAt: true,
      options: { select: { id: true, kind: true, value: true, stock: true } },
    },
  });
  if (!product) throw notFound();

  // Target resolution (documented above). A missing option inside an owned
  // product is the identical generic 404 — options leak nothing either.
  const resolution = resolveInventoryTarget(product, optionId ?? null);
  if (!resolution.ok) {
    if (resolution.code === "missing") throw notFound();
    if (resolution.code === "option_not_tracked") {
      throw badInput("the selected option does not track inventory; the product-level quantity governs it");
    }
    throw badInput("this product has stock-tracking options; target exactly one option per proposal (optionId required)");
  }
  const { currentCount, option } = resolution;

  // Bounds + nonnegative-result rules (documented above). An out-of-bounds or
  // negative-result change is a deterministic 400 — no proposal row, no
  // outbox event, no side effect of any kind.
  const change = { adjustment: input.adjustment, setTo: input.setTo };
  const rejection = inventoryAdjustmentRejectionFor(change, currentCount);
  if (rejection === "invalid_change") throw badInput("exactly one of adjustment or setTo is required");
  if (rejection === "out_of_bounds") throw badInput("the requested change is outside the configured bounds");
  if (rejection === "negative_result") throw badInput("the requested count would be negative");
  const requestedCount = requestedCountFor(change, currentCount);

  const productName = String(product.name).slice(0, PRODUCT_NAME_MAX);
  const preview = {
    actionKind: INVENTORY_ADJUST_ACTION_KIND,
    productId: product.id,
    productName,
    ...(option
      ? {
          optionId: option.id,
          optionKind: String(option.kind).slice(0, OPTION_KIND_MAX),
          optionValue: String(option.value).slice(0, OPTION_VALUE_MAX),
        }
      : {}),
    currentCount,
    requestedCount,
    reason,
    disclosedConsequences: inventoryDisclosuresFor(
      option ? optionLabelOf(productName, option) : `"${productName.slice(0, DISCLOSURE_NAME_MAX)}"`,
      currentCount,
      requestedCount,
    ),
  };

  // The canonical payload stores the exact applied-change contract AND the
  // exact before-value: execution revalidates against both (version proxy +
  // count equality) and applies only the stored numbers — the HTTP body of
  // the execute call carries nothing. The reason rides along for the review
  // screen; audits project it out.
  const canonicalPayload = {
    productId: product.id,
    optionId: option ? option.id : null,
    adjustment: input.adjustment ?? null,
    setTo: input.setTo ?? null,
    currentCount,
    requestedCount,
    reason,
  };
  const payloadHash = canonicalPayloadHash(canonicalPayload);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  const id = generateId();

  await client.proposal.create({
    data: {
      id,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind: INVENTORY_ADJUST_ACTION_KIND,
      // The targeted row: one option, or the product-level quantity counter.
      targetType: option ? "product_option" : "product",
      targetId: option ? option.id : product.id,
      canonicalPayload,
      preview,
      // Version proxy: the parent product's updatedAt in epoch SECONDS
      // (int4-safe). ProductOption has no updatedAt of its own — any product
      // mutation and any sale touching the product makes the proposal stale,
      // and the exact before-value equality check below covers the counter
      // itself (defense in depth).
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
