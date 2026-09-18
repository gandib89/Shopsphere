// Admin recommendation drafts for issue #21.
// DETERMINISTIC, TEMPLATE-BASED COMPOSITION ONLY: each draft is assembled from
// the authorized minimized admin view (seller application, return queue row,
// promotion configuration + aggregate usage) plus approved, versioned policy
// answers (services/assistantPolicy.js). There is no LLM, no network call, and
// NO AUTHORITY of any kind on this path — the drafts cannot approve or reject
// sellers or returns, cannot release refunds, cannot activate or deactivate
// promotions, cannot reset usage counters, and cannot notify anyone. Every
// absent fact renders as the literal string "unknown" — never inferred, never
// fabricated. Recommendations are addressed to human reviewers, who alone make
// and record decisions in the ShopSphere admin console.
//
// Inputs carry opaque references only: the seller draft takes the
// seller-<digest> reference emitted by list_seller_applications (resolved
// server-side through the read service's internal helper — never a raw user id
// or email), the return draft resolves through the exact fixed return-queue
// membership rule, and the promotion draft resolves through the promotion read
// service. Foreign, missing, out-of-window, non-queued, and quarantined
// references all produce the identical generic 404.
import { getApprovedPolicy } from "./assistantPolicy.js";
import { findSellerApplicationByReference } from "./assistantAdminReads.js";
import { findReturnQueueOrder } from "./assistantAdminQueues.js";
import { findPromotionWithUsage } from "./assistantAdminPromotions.js";

export const MAX_DRAFT_LENGTH = 4000;
export const MAX_PURPOSE_CHARS = 500;
const UNKNOWN = "unknown";

// Approved policy topics: the seller draft cites the approved seller-onboarding
// policy (the verification flow lives there), the return draft cites the
// approved returns policy. No promotion topic exists in POLICY_TOPICS today —
// the promotion draft states that explicitly instead of inventing guidance.
export const SELLER_REVIEW_POLICY_TOPIC = "seller-onboarding";
export const RETURN_REVIEW_POLICY_TOPIC = "returns";
export const PROMOTION_REVIEW_POLICY_TOPIC = "promotions";

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Defense in depth for direct service callers; the route additionally admits
// only delegated tokens carrying recommendations:draft whose live account is
// an admin.
const assertAdminPrincipal = (principal) => {
  if (principal?.role !== "admin") {
    throw Object.assign(new Error("Administrator access required"), { statusCode: 403, code: "role_not_allowed" });
  }
};

const orUnknown = (value) => {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === "string" && value.trim() === "") return UNKNOWN;
  return value;
};

// Bound the final draft to MAX_DRAFT_LENGTH, cutting on a whitespace boundary
// when one exists and never splitting a surrogate pair. Reports truncation.
const boundDraft = (text) => {
  if (text.length <= MAX_DRAFT_LENGTH) return { draft: text, truncated: false };
  let sliced = text.slice(0, MAX_DRAFT_LENGTH);
  const lastCode = sliced.codePointAt(sliced.length - 1) ?? 0;
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) sliced = sliced.slice(0, -1);
  const boundary = Math.max(sliced.lastIndexOf(" "), sliced.lastIndexOf("\n"));
  if (boundary > 0) sliced = sliced.slice(0, boundary);
  return { draft: sliced, truncated: true };
};

const citationsOf = (policy) => Object.freeze(
  (policy?.sources ?? []).map(({ sourceId, sourceVersion }) => ({ sourceId, sourceVersion })),
);

// Ground the guidance exclusively in the approved source. Without an approved
// source the draft says so explicitly instead of inventing guidance.
const guidanceOf = (policy) => (
  policy?.sources?.length > 0 && typeof policy?.answer === "string" && policy.answer.trim() !== ""
    ? policy.answer
    : "No approved ShopSphere policy is available for this topic, so no policy guidance is included here."
);

// Next-step text grounded ONLY in the minimized application facts and the
// approved policy restated above it. It recommends human review; it never
// issues an approval or rejection and never records an outcome.
const sellerNextStep = (application) => {
  if (application.status === "pending") {
    return "the application is awaiting verification; a human reviewer may assess the submitted shop details against the approved seller-onboarding policy quoted above and record the outcome in the ShopSphere admin review process.";
  }
  if (application.status === "approved") {
    return `the application has already been verified (decision date ${application.decisionDate ?? UNKNOWN}); no verification action appears pending, so this summary is for reference only.`;
  }
  if (application.status === "rejected") {
    return "a rejection decision has previously been recorded for this application; a human reviewer may re-assess the stored facts if the seller reapplies, using the approved policy quoted above.";
  }
  return `the application status is ${UNKNOWN}; a human reviewer would need to confirm the current state in the ShopSphere admin review process before any assessment.`;
};

const returnNextStep = (order) => {
  if (order.status === "Return Requested") {
    return "the return is awaiting a decision; a human reviewer may compare the submitted reason (and the attached image, if any) against the approved returns policy quoted above and record the outcome in the ShopSphere admin review process.";
  }
  if (order.status === "Return Approved") {
    return "a return approval has already been recorded; whether any refund follows is a separate decision that a human reviewer must make and release through the admin refund process.";
  }
  if (order.status === "Return Rejected") {
    return "a return rejection has already been recorded; a human reviewer may re-assess the stored facts if the buyer contacts support, using the approved returns policy quoted above.";
  }
  return `the stored status is ${UNKNOWN}; a human reviewer would need to confirm the current state in the ShopSphere admin review process before any assessment.`;
};

const discountText = (promotion) => {
  if (promotion.discountType === "percentage") {
    return `percentage, ${orUnknown(promotion.discountValue?.percent)} percent`;
  }
  if (promotion.discountType === "fixed") {
    return `fixed, ${orUnknown(promotion.discountValue?.amount)} ${promotion.discountValue?.currency ?? UNKNOWN}`;
  }
  return UNKNOWN;
};

// Next-step text grounded ONLY in the allowlisted configuration and aggregate
// usage counters. It recommends human consideration; it never activates,
// deactivates, resets, or notifies.
const promotionNextStep = (promotion, now) => {
  const expired = promotion.validUntil != null && new Date(promotion.validUntil).getTime() < now.getTime();
  if (expired) {
    return "the configured validity window has ended; a human reviewer may consider whether the campaign should be renewed or retired, and record any change in the ShopSphere admin console.";
  }
  if (promotion.usageLimit != null) {
    const remaining = promotion.usageLimit - promotion.usedCount;
    if (remaining <= 0) {
      return "the recorded redemption count has reached the configured usage limit; the promotion cannot grant further discounts while the limit stands, and only a human reviewer may consider changing the configuration.";
    }
    if (promotion.usedCount / promotion.usageLimit >= 0.8) {
      return "usage is approaching the configured limit; a human reviewer may consider whether the limit and validity window still fit the campaign, and record any change in the ShopSphere admin console.";
    }
    return `the configured usage limit has ${remaining} redemptions remaining; a human reviewer may continue monitoring usage and consider changes only through the ShopSphere admin console.`;
  }
  if (!promotion.isActive) {
    return "the promotion is currently inactive; a human reviewer may consider whether to run it, and this draft does not change that state.";
  }
  return "no usage limit is configured and the promotion is active; a human reviewer may continue monitoring usage and consider changes only through the ShopSphere admin console.";
};

const draftOutput = ({ lines, policy, now }) => {
  const { draft, truncated } = boundDraft(lines.join("\n"));
  return {
    recommendation: draft,
    truncated,
    citations: citationsOf(policy),
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
};

export const draftSellerReviewRecommendation = async (
  { sellerReference } = {},
  { client, principal, policySource = getApprovedPolicy, now = new Date() } = {},
) => {
  assertAdminPrincipal(principal);
  // Resolution re-derives the opaque reference over a bounded scan of the
  // seller-application projection; a malformed, foreign, or missing reference
  // all resolve to null here and produce the identical generic 404.
  const application = await findSellerApplicationByReference(sellerReference, { client });
  if (!application) throw notFound();

  const policy = await policySource(SELLER_REVIEW_POLICY_TOPIC);
  const lines = [
    "Seller application review recommendation (draft for a human reviewer).",
    "",
    "This draft was composed only from the minimized seller-application facts below and the approved ShopSphere policy quoted further down. It is a recommendation for human review, not a decision: nothing has been recorded, and approving or rejecting the application remains a human action in the ShopSphere admin console.",
    "",
    `Seller reference: ${orUnknown(application.sellerReference)}`,
    `Shop name: ${orUnknown(application.shopName)}`,
    `Application status: ${orUnknown(application.status)}`,
    `Requested at: ${orUnknown(application.requestDate)}`,
    `Decision date: ${orUnknown(application.decisionDate)}`,
    "",
    "Shop description as submitted:",
    orUnknown(application.shopDescription),
    "",
    "Approved ShopSphere seller-onboarding policy:",
    guidanceOf(policy),
    "",
    `Recommended next step: ${sellerNextStep(application)}`,
  ];
  return draftOutput({ lines, policy, now });
};

// The purpose is admin-supplied bounded text and the explicit "why" of this
// access. It is threaded through the route's observe() seam into the durable
// audit event's redacted input metadata (never into the tool response).
export const returnReviewObserve = (output, input) => ({
  resourceIds: [input?.orderId].filter((value) => typeof value === "string" && value.length > 0),
  rowCount: 1,
  auditMetadata: { purpose: String(input?.purpose ?? "").slice(0, MAX_PURPOSE_CHARS) },
});

export const draftReturnReviewRecommendation = async (
  { orderId, purpose } = {},
  { client, principal, policySource = getApprovedPolicy, now = new Date() } = {},
) => {
  assertAdminPrincipal(principal);
  if (typeof purpose !== "string" || purpose.trim().length < 10 || purpose.length > MAX_PURPOSE_CHARS) {
    throw badInput("purpose must be 10 to 500 characters");
  }
  // Same fixed queue-membership rule as the return queue (lifecycle statuses +
  // requested return + rolling 90-day window + attribution quarantine): a
  // foreign id, a missing id, an out-of-window order, a well-formed but
  // non-queued order, and a quarantined legacy row all resolve to null here
  // and produce the identical generic 404 with no existence leak.
  const order = await findReturnQueueOrder({ orderId }, { client, now });
  if (!order) throw notFound();

  const policy = await policySource(RETURN_REVIEW_POLICY_TOPIC);
  const lines = [
    "Return review recommendation (draft for a human reviewer).",
    "",
    "This draft was composed only from the minimized return facts below and the approved ShopSphere policy quoted further down. It is a recommendation for human review, not a decision: nothing has been recorded, the return outcome remains a human action in the ShopSphere admin console, and any refund is a separate decision that this draft cannot carry out.",
    "",
    `Order id: ${orUnknown(order.orderId)}`,
    `Order number: ${orUnknown(order.orderNumber)}`,
    `Order status: ${orUnknown(order.status)}`,
    `Return requested at: ${orUnknown(order.returnRequestedAt)}`,
    "Return image attached: " + (order.hasReturnImage ? "yes" : "no"),
    "",
    "Return reason as submitted:",
    orUnknown(order.returnReason),
    "",
    "Approved ShopSphere returns policy:",
    guidanceOf(policy),
    "",
    `Recommended next step: ${returnNextStep(order)}`,
  ];
  return draftOutput({ lines, policy, now });
};

export const draftPromotionRecommendation = async (
  { promoCodeId } = {},
  { client, principal, policySource = getApprovedPolicy, now = new Date() } = {},
) => {
  assertAdminPrincipal(principal);
  // Resolution through the promotion read service: a missing or out-of-scope
  // id resolves to null here and produces the identical generic 404.
  const promotion = await findPromotionWithUsage({ promoCodeId }, { client });
  if (!promotion) throw notFound();

  // No promotion topic exists in POLICY_TOPICS today, so no approved policy
  // source can exist; the draft says so explicitly instead of inventing
  // campaign guidance. If a topic is approved later, the citation appears here
  // without further changes.
  const policy = await policySource(PROMOTION_REVIEW_POLICY_TOPIC);
  const lines = [
    "Promotion review recommendation (draft for a human reviewer).",
    "",
    "This draft was composed only from the allowlisted promotion configuration and the aggregate usage counters below. It is a recommendation for human review, not a decision: nothing has been recorded, and activating or deactivating the promotion, resetting usage, or notifying users remain human actions in the ShopSphere admin console.",
    "",
    `Promotion code id: ${orUnknown(promotion.promoCodeId)}`,
    `Code: ${orUnknown(promotion.code)}`,
    "Active: " + (promotion.isActive ? "yes" : "no"),
    `Discount: ${discountText(promotion)}`,
    `Minimum purchase: ${orUnknown(promotion.minPurchase?.amount)} ${promotion.minPurchase?.currency ?? UNKNOWN}`,
    `Maximum discount: ${promotion.maxDiscount ? `${promotion.maxDiscount.amount} ${promotion.maxDiscount.currency}` : UNKNOWN}`,
    `Valid from: ${orUnknown(promotion.validFrom)}`,
    `Valid until: ${orUnknown(promotion.validUntil)}`,
    `Total redemptions recorded: ${promotion.usedCount}`,
    `Distinct users recorded: ${promotion.distinctUsers}`,
    promotion.usageLimit == null
      ? "No usage limit is configured."
      : `Usage limit: ${promotion.usageLimit}`,
    "",
    "Approved ShopSphere promotion policy:",
    guidanceOf(policy),
    "",
    `Recommended next step: ${promotionNextStep(promotion, now instanceof Date ? now : new Date(now))}`,
  ];
  return draftOutput({ lines, policy, now });
};
