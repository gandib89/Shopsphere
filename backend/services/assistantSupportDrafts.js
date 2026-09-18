// Buyer support-message drafting for issue #19.
// DETERMINISTIC, TEMPLATE-BASED COMPOSITION ONLY: the draft is assembled from
// minimized buyer-owned order facts plus approved, versioned policy answers
// (services/assistantPolicy.js). There is no LLM, no network call, and NO
// DELIVERY of any kind on this path — it cannot send email or chat, create a
// ticket or notification, or invoke a webhook. The buyer chooses the order and
// the bounded topic; no recipient, channel, or send affordance exists here.
// Every absent fact renders as the literal string "unknown" — never inferred,
// never fabricated. Foreign and missing order ids are indistinguishable.
import { getApprovedPolicy } from "./assistantPolicy.js";
import { buildBuyerOrderWhere } from "./orderOwnership.js";

export const DRAFT_TOPICS = Object.freeze([
  "order_status",
  "delivery_issue",
  "return_question",
  "refund_question",
  "other",
]);

// Draft topics map onto the approved policy topics served by getApprovedPolicy
// (versioned faqs.json sources). "other" falls back to the support-contact
// policy; refund questions use the closest approved source (payment).
const TOPIC_POLICY_SOURCES = Object.freeze({
  order_status: "tracking",
  delivery_issue: "delivery",
  return_question: "returns",
  refund_question: "payment",
  other: "support-contact",
});

export const MAX_DRAFT_LENGTH = 4000;
export const MAX_NOTES_LENGTH = 500;
const UNKNOWN = "unknown";

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Minimized order projection for the draft: order number, coarse status,
// placed-at, item summary, and the fulfilment milestone timestamps used only
// to derive a coarse delivery stage. No buyer identity, addresses, emails,
// money, promo linkage, or return-reason content.
const draftOrderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  quantity: true,
  createdAt: true,
  confirmedAt: true,
  processingAt: true,
  shippedAt: true,
  deliveredAt: true,
  product: { select: { name: true } },
};

const orUnknown = (value) => {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === "string" && value.trim() === "") return UNKNOWN;
  return value;
};

// Coarse delivery stage derived ONLY from recorded milestone timestamps —
// the timestamps themselves never appear in the draft, and an order with no
// recorded milestones renders "unknown" instead of an inferred stage.
const deliveryStage = (row) => {
  const stages = [
    ["deliveredAt", "Delivered"],
    ["shippedAt", "Shipped"],
    ["processingAt", "Processing"],
    ["confirmedAt", "Confirmed"],
  ];
  for (const [field, label] of stages) {
    if (row[field]) return label;
  }
  return UNKNOWN;
};

const itemSummary = (row) => {
  const name = typeof row.product?.name === "string" && row.product.name.trim() !== ""
    ? row.product.name
    : null;
  const quantity = Number.isInteger(row.quantity) && row.quantity > 0
    ? String(row.quantity)
    : null;
  if (name && quantity) return `${name} (quantity: ${quantity})`;
  if (name) return `${name} (quantity: ${UNKNOWN})`;
  if (quantity) return `${UNKNOWN} (quantity: ${quantity})`;
  return UNKNOWN;
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

export const draftSupportMessage = async (
  { orderId, topic, notes } = {},
  { client, principal, policySource = getApprovedPolicy, now = new Date() } = {},
) => {
  if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 24) throw notFound();
  if (!DRAFT_TOPICS.includes(topic)) throw badInput(`Unknown draft topic: ${String(topic)}`);

  // Single scoped read through the immutable buyer attribution
  // (Order.userId = delegated subject, never an email). A foreign or missing
  // id both resolve to null here and produce the identical generic 404.
  const row = await client.order.findFirst({
    where: buildBuyerOrderWhere(principal.subject, { id: orderId }),
    select: draftOrderSelect,
  });
  if (!row) throw notFound();

  const policy = await policySource(TOPIC_POLICY_SOURCES[topic]);
  const citations = Object.freeze(
    (policy?.sources ?? []).map(({ sourceId, sourceVersion }) => ({ sourceId, sourceVersion })),
  );
  // Ground the topic guidance exclusively in the approved source. Without an
  // approved source the draft says so explicitly instead of inventing guidance.
  const guidance = citations.length > 0 && typeof policy?.answer === "string" && policy.answer.trim() !== ""
    ? policy.answer
    : "No approved ShopSphere policy is available for this topic yet, so no policy guidance is included here.";

  // Buyer-authored notes: bounded to MAX_NOTES_LENGTH and included exactly
  // once in the draft body (they are never logged or audited anywhere).
  const boundedNotes = typeof notes === "string" && notes.length > 0
    ? notes.slice(0, MAX_NOTES_LENGTH)
    : null;

  const lines = [
    "Hello ShopSphere support team,",
    "",
    "I need help with an order I placed on ShopSphere.",
    "",
    `Order number: ${orUnknown(row.orderNumber)}`,
    `Order status: ${orUnknown(row.status)}`,
    `Placed at: ${row.createdAt?.toISOString?.() ?? UNKNOWN}`,
    `Item: ${itemSummary(row)}`,
    `Delivery stage: ${deliveryStage(row)}`,
    "",
    `Topic: ${topic}`,
    ...(boundedNotes ? [`Notes from the buyer: ${boundedNotes}`] : []),
    "",
    "Approved ShopSphere policy for this topic:",
    guidance,
    "",
    "Could you please advise on the next steps for this order?",
    "",
    "Thank you,",
    "A ShopSphere buyer",
  ];
  const { draft, truncated } = boundDraft(lines.join("\n"));

  return {
    orderId: row.id,
    topic,
    draft,
    truncated,
    citations,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
};
