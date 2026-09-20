// Buyer return proposals for issue #25, on the #22 proposal platform.
//
// proposeOrderReturn persists ONLY a proposal row (plus one "created" outbox
// event): it never writes a live return request (orders.returnRequestedAt /
// returnReason / returnImage stay untouched), never notifies anyone, and never
// touches payments or refunds. The input carries exactly { orderId, reason } —
// there is no evidence URL, attachment path, or image field anywhere in the
// contract, so arbitrary evidence links cannot enter through it. Evidence
// photos are collected exclusively through ShopSphere's existing trusted
// upload control (the multer uploadImage path) after the buyer confirms.
//
// Eligibility is grounded in the CURRENT approved return policy (the versioned
// faqs.json answer served by services/assistantPolicy.js — "You can return any
// product within 7 days of delivery as long as it is unused and in its original
// packaging", cited in every preview) AND the owned order's live state: the
// order must be "Delivered" (exact stored storefront string), must have no
// returnRequestedAt yet, and must sit inside the policy window measured from
// deliveredAt. Foreign and missing order ids resolve to the identical generic
// 404 via the immutable buyer predicate (buildBuyerOrderWhere).
//
// Version proxy: Order had no mutation marker, so migration
// 20260919195959_order_updated_at added orders."updatedAt" (maintained by
// Prisma @updatedAt). Proposal.expectedVersion stores Math.floor(
// order.updatedAt.getTime() / 1000) — epoch SECONDS, because expectedVersion is
// an int4 column and epoch milliseconds (1.7e12) overflow its 2^31-1 bound.
// Execution requires the proxy to be unchanged; second granularity means two
// writes inside the same second are not distinguished by the proxy alone, which
// is acceptable because the harmful concurrent changes (status, returnRequestedAt,
// window) are revalidated independently below.
//
// All operations run inside withAssistantActor as shopsphere_assistant_private_runtime:
// the RLS policies key rows on the actor GUCs, so the subject scoping below is
// defense in depth, not the only gate.
import crypto from "node:crypto";

import { getApprovedPolicy } from "./assistantPolicy.js";
import { money, toCents } from "./assistantMoney.js";
import { generateId } from "../utils/generateId.js";
import { buildBuyerOrderWhere } from "./orderOwnership.js";
import { PROPOSAL_TTL_MS, canonicalPayloadHash } from "./assistantProposals.js";

export const RETURN_ACTION_KIND = "order.return_request";

// The approved policy answer states the window ("within 7 days of delivery");
// the day count is extracted from the live approved answer rather than hard
// coded, so a re-approved policy immediately re-grounds eligibility. Parsing
// fails closed: without a window in the answer and a versioned source, proposal
// creation and execution are refused (503), never silently widened.
const RETURN_WINDOW_PATTERN = /within\s+(\d+)\s+day/i;

export const RETURN_DISCLOSURES = Object.freeze([
  "Creates a return request for seller/admin review",
  "Evidence photos are uploaded in ShopSphere, not here",
  "No refund is released by this action",
]);

export const RETURN_NEXT_STEPS = Object.freeze([
  "Upload return evidence photos in ShopSphere on your order page using the existing image upload control",
  "Seller or admin staff will review your return request in ShopSphere",
  "Any refund is a separate admin decision and is never released by this action",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });
const policyUnavailable = () =>
  Object.assign(new Error("Approved return policy is unavailable"), { statusCode: 503, code: "policy_unavailable" });
const notReturnEligible = () =>
  Object.assign(new Error("Order is not eligible for a return request"), { statusCode: 409, code: "not_return_eligible" });

// Validates the approved returns-policy answer and projects its versioned
// citations. Throws 503 (fail closed) when the answer carries no day window or
// no source — eligibility is then unknowable from approved sources.
export const approvedReturnWindow = (policy) => {
  const answer = typeof policy?.answer === "string" ? policy.answer : "";
  const match = RETURN_WINDOW_PATTERN.exec(answer);
  const windowDays = match ? Number(match[1]) : NaN;
  const policyBasis = (Array.isArray(policy?.sources) ? policy.sources : [])
    .filter((source) => source && typeof source.sourceId === "string" && typeof source.sourceVersion === "string")
    .map(({ sourceId, sourceVersion }) => ({ sourceId, sourceVersion }));
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 365 || policyBasis.length === 0) {
    throw policyUnavailable();
  }
  return { windowDays, policyBasis };
};

// Eligible state = exact stored status "Delivered" (the storefront's return
// lifecycle entry state), no return request yet, a recorded deliveredAt, and
// still inside the policy window measured from deliveredAt. An order delivered
// but missing its deliveredAt timestamp is NOT eligible — the window cannot be
// established from approved sources, so it fails closed.
export const isOrderReturnEligible = (order, { now, windowDays }) => {
  if (!order || order.status !== "Delivered") return false;
  if (order.returnRequestedAt !== null && order.returnRequestedAt !== undefined) return false;
  if (!(order.deliveredAt instanceof Date) || Number.isNaN(order.deliveredAt.getTime())) return false;
  return now.getTime() - order.deliveredAt.getTime() <= windowDays * DAY_MS;
};

// The documented version proxy (see module comment): epoch seconds of updatedAt.
export const orderVersionProxy = (order) => Math.floor(order.updatedAt.getTime() / 1000);

const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  totalPrice: true,
  deliveredAt: true,
  returnRequestedAt: true,
  updatedAt: true,
};

export const proposeOrderReturn = async (
  input,
  { client, principal, policySource = getApprovedPolicy, now = new Date() } = {},
) => {
  if (!input || typeof input.orderId !== "string" || input.orderId.length === 0 || input.orderId.length > 24) {
    throw notFound();
  }
  if (typeof input.reason !== "string" || input.reason.length < 10 || input.reason.length > 1000) {
    throw badInput("Invalid return reason");
  }
  const at = now instanceof Date ? now : new Date(now);

  // Ground the window in the current approved policy BEFORE touching data; an
  // ungrounded policy refuses the operation instead of inventing a window.
  const { windowDays, policyBasis } = approvedReturnWindow(await policySource("returns"));

  // Single scoped read through the immutable buyer attribution (Order.userId =
  // delegated subject, never an email). A foreign or missing id both resolve to
  // null here and produce the identical generic 404 — no existence leak.
  const order = await client.order.findFirst({
    where: buildBuyerOrderWhere(principal.subject, { id: input.orderId }),
    select: orderSelect,
  });
  if (!order) throw notFound();

  // Ineligible owned orders are a deterministic 409 — no proposal row, no
  // outbox event, no side effect of any kind.
  if (!isOrderReturnEligible(order, { now: at, windowDays })) throw notReturnEligible();

  const canonicalPayload = { orderId: input.orderId, reason: input.reason };
  const preview = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    currentStatus: order.status, // exact stored storefront string, e.g. "Delivered"
    returnEligible: true,
    orderTotal: money(toCents(order.totalPrice)),
    policyBasis,
    disclosedConsequences: [...RETURN_DISCLOSURES],
  };

  const payloadHash = canonicalPayloadHash(canonicalPayload);
  const expiresAt = new Date(at.getTime() + PROPOSAL_TTL_MS); // exactly ten minutes
  const id = generateId();

  await client.proposal.create({
    data: {
      id,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind: RETURN_ACTION_KIND,
      targetType: "order",
      targetId: order.id,
      canonicalPayload,
      preview,
      expectedVersion: orderVersionProxy(order),
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

// First-party execution revalidation (called from routes/proposalExecutionRoute.js
// inside its transaction, as the application owner). Re-checks the live owned
// order against the CURRENT approved policy window and the exact business state,
// then the version proxy. Order of checks mirrors the ticket: business state
// first (a changed state is "rejected" — the order can no longer be returned),
// then the version proxy ("stale" — the order moved on in some other way).
// Missing order (deleted or no longer owned) is "rejected". No branch mutates.
export const revalidateReturnForExecution = async (
  tx,
  { proposal, account, now, policySource = getApprovedPolicy },
) => {
  const { windowDays } = approvedReturnWindow(await policySource("returns"));
  const order = await tx.order.findFirst({
    where: buildBuyerOrderWhere(account.id, { id: proposal.targetId }),
    select: orderSelect,
  });
  if (!order) return { ok: false, terminal: "rejected" };
  if (!isOrderReturnEligible(order, { now, windowDays })) return { ok: false, terminal: "rejected" };
  if (orderVersionProxy(order) !== proposal.expectedVersion) return { ok: false, terminal: "stale" };
  return { ok: true, order };
};

// Applies the exact stored canonical request to the order, mirroring the
// storefront's buyer-facing return initiation (controller/order.js requestReturn):
// status "Return Requested" + returnRequestedAt + returnReason — and nothing
// else. No returnImage is written here (evidence upload stays in ShopSphere's
// trusted multer flow), no payment/refund call exists on this path, and no
// email/notification is sent by the proposal platform.
export const applyReturnRequest = async (tx, { order, proposal, now }) => {
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: "Return Requested",
      returnRequestedAt: now,
      returnReason: proposal.canonicalPayload.reason,
    },
  });
};
