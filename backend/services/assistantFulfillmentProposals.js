// Seller fulfillment-transition proposals for issue #29, on the #22 proposal
// platform.
//
// proposeFulfillmentTransition persists ONLY a proposal row (plus the
// platform's one "created" outbox event in the same transaction): it never
// updates an order row, never deducts or restores stock, never touches
// payments or refunds, and never sends an email or writes a notification. The
// live mutation happens exclusively through the first-party browser execution
// endpoint (routes/proposalExecutionRoute.js).
//
// Attribution: the sale line IS the Order row, authorized through the immutable
// sellerIdAtPurchase snapshot (buildSellerOrderWhere) — never the current
// Product.sellerId (ownership can transfer after purchase) and never a
// caller-supplied seller id. Rows whose attribution is still NULL (legacy /
// unrepaired) are quarantined: they match no predicate, so foreign, missing,
// and quarantined ids resolve to the identical generic 404 with no existence
// leak.
//
// Eligibility is the exact storefront seller state machine (controller/order.js
// SELLER_FULFILLMENT_TRANSITIONS, reused — not duplicated): the current status
// must be "Confirmed", "Processing", or "Shipped" and nextStatus must be the
// EXACT next stage. "Pending" can never be proposed out of (moving out of
// Pending is confirmOrderCore's verified-payment gate, and Pending → Confirmed
// is not a seller transition at all), and Delivered / Cancelled / return /
// refund states are terminal for sellers. An OWNED but ineligible sale line
// creates NO proposal and fails with the deterministic 409 not_fulfillable —
// the same established seam mapping #25 uses (the privateOperation seam maps a
// 409 statusCode to the error's own code, so the denial stays bounded and
// deterministic; 404 stays reserved exclusively for foreign/missing identity).
//
// Version semantics: orders carry no version column, so expectedVersion is the
// shared orderVersionOf(order.updatedAt) epoch-seconds proxy from
// assistantCancellationProposals.js (reused, never duplicated). Propose and
// execution derive it with the same helper, so any committed order change
// after the preview makes the proposal stale at execution.
//
// Both operations run inside withAssistantActor as
// shopsphere_assistant_private_runtime: the RLS policies key rows on the actor
// GUCs (migration 20260919250000_assistant_fulfillment_proposals), so the
// subject scoping below is defense in depth, not the only gate.
import crypto from "node:crypto";

import { z } from "zod";

import {
  SELLER_FULFILLMENT_TRANSITIONS,
  STAGE_TIMESTAMP_FIELD,
} from "../controller/order.js";
import { buildSellerOrderWhere } from "./orderOwnership.js";
import { PROPOSAL_TTL_MS, canonicalPayloadHash } from "./assistantProposals.js";
import { orderVersionOf } from "./assistantCancellationProposals.js";
import { generateId } from "../utils/generateId.js";

export const FULFILLMENT_ACTION_KIND = "sale.advance_fulfillment";
export const FULFILLMENT_TARGET_TYPE = "order";

// Strict input schema (#29). Exported so the route and the tests exercise the
// identical object: there is NO currentStatus input (the server derives it from
// the stored row) and NO confirm/execute affordance — forged fields fail the
// strict schema, not the order.
export const saleLineIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "saleLineId must be a 24-character id");

export const proposeFulfillmentTransitionInputSchema = z
  .object({
    saleLineId: saleLineIdSchema,
    nextStatus: z.enum(["Processing", "Shipped", "Delivered"]),
  })
  .strict();

// Fixed follow-up disclosures shown to the reviewer. The exact same strings are
// served by the first-party review endpoint, so the review screen and the MCP
// preview can never drift apart. The notification line is the honest disclosure
// decision documented in the execution path: the storefront fulfillment flow
// sends the buyer a status email inline (controller/order.js
// updateSellerOrderStatus -> sendEmail), but MCP-proposed execution writes NO
// email and NO notification — the disclosure names the transactional
// notification and states exactly what this execution does (nothing).
const disclosedConsequencesFor = (timestampField) => [
  `Sets ${timestampField} on the sale line`,
  "No buyer notification or email is sent by this execution (the storefront fulfillment flow normally sends one)",
  "No payment, refund, or stock change happens",
];

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
// Owned-but-ineligible is a deterministic business denial, not an identity
// leak: it never merges with the 404 path. See the module comment.
const notFulfillable = () =>
  Object.assign(new Error("Sale line cannot advance to that status"), { statusCode: 409, code: "not_fulfillable" });

// The exact server rule, shared by proposal creation and first-party execution:
// the transition is fulfillable only when nextStatus is the EXACT next seller
// stage of the CURRENT stored status. Pending, Delivered, Cancelled, and the
// return/refund states have no next stage here, so they can never be proposed
// out of — including "Pending → Confirmed", which is confirmOrderCore's
// verified-payment gate, never a proposal.
export const isFulfillableTransition = (currentStatus, nextStatus) =>
  SELLER_FULFILLMENT_TRANSITIONS[currentStatus] === nextStatus;

// The single stage timestamp this transition backfills (mirrors the storefront
// update: the field is only set when still empty — `order[field] || now`).
export const stageTimestampFieldFor = (nextStatus) => STAGE_TIMESTAMP_FIELD[nextStatus];

const isoOrNull = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);

const saleLineSelect = {
  id: true,
  orderNumber: true,
  status: true,
  confirmedAt: true,
  processingAt: true,
  shippedAt: true,
  deliveredAt: true,
  updatedAt: true,
  product: { select: { name: true } },
};

export const proposeFulfillmentTransition = async (input, { client, principal, now = new Date() }) => {
  // Identity-shaped ids: a malformed, foreign, missing, or quarantined sale
  // line is the identical generic 404 (the store predicates simply match no
  // row). No existence leak, and no proposal row on any denial.
  if (!input || typeof input.saleLineId !== "string" || !/^[a-f0-9]{24}$/.test(input.saleLineId)) {
    throw notFound();
  }

  // Read-only owned-sale-line load through the IMMUTABLE sellerIdAtPurchase
  // attribution only (never current product ownership, never a supplied
  // seller id, never a storefront fallback).
  const order = await client.order.findFirst({
    where: buildSellerOrderWhere(principal.subject, { id: input.saleLineId }),
    select: saleLineSelect,
  });
  if (!order) throw notFound();

  // Only a sale line sitting exactly one allowed step away from the requested
  // stage can produce a bounded proposal. Ineligible lines (Pending, terminal,
  // return states, or a skipped/unknown stage) fail deterministically before
  // anything is persisted.
  if (!isFulfillableTransition(order.status, input.nextStatus)) throw notFulfillable();

  const timestampField = stageTimestampFieldFor(input.nextStatus);
  const preview = {
    actionKind: FULFILLMENT_ACTION_KIND,
    saleLineId: order.id,
    orderNumber: order.orderNumber ? String(order.orderNumber).slice(0, 100) : null,
    productName: order.product?.name ? String(order.product.name).slice(0, 200) : null,
    currentStatus: order.status, // exact stored storefront string
    nextStatus: input.nextStatus,
    stageTimestamps: {
      confirmedAt: isoOrNull(order.confirmedAt),
      processingAt: isoOrNull(order.processingAt),
      shippedAt: isoOrNull(order.shippedAt),
      deliveredAt: isoOrNull(order.deliveredAt),
    },
    willSetTimestamp: timestampField,
    disclosedConsequences: disclosedConsequencesFor(timestampField),
  };

  const canonicalPayload = { saleLineId: order.id, nextStatus: input.nextStatus };
  const payloadHash = canonicalPayloadHash(canonicalPayload);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);
  const id = generateId();

  await client.proposal.create({
    data: {
      id,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind: FULFILLMENT_ACTION_KIND,
      targetType: FULFILLMENT_TARGET_TYPE,
      targetId: order.id,
      canonicalPayload,
      preview,
      // Shared epoch-seconds proxy over order.updatedAt (documented in
      // assistantCancellationProposals.js): any committed order change after
      // the preview makes this proposal stale at execution.
      expectedVersion: orderVersionOf(order),
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

// ---------------------------------------------------------------------------
// First-party execution revalidation (called from
// routes/proposalExecutionRoute.js inside its transaction, as the application
// owner). Order of checks mirrors #25: business state first (a moved status is
// "rejected" — the exact next stage no longer applies), then the version proxy
// ("stale" — the sale line moved on in some other way). A missing order
// (deleted or no longer attributed to this seller) is "rejected": the proposal
// can never be applied. No branch mutates anything.
// ---------------------------------------------------------------------------
export const revalidateFulfillmentForExecution = async (tx, { proposal, account }) => {
  const nextStatus =
    typeof proposal.canonicalPayload?.nextStatus === "string" ? proposal.canonicalPayload.nextStatus : "";
  const order = await tx.order.findFirst({
    where: buildSellerOrderWhere(account.id, { id: proposal.targetId }),
    select: {
      id: true,
      status: true,
      confirmedAt: true,
      processingAt: true,
      shippedAt: true,
      deliveredAt: true,
      updatedAt: true,
    },
  });
  if (!order) return { ok: false, terminal: "rejected" };
  if (!isFulfillableTransition(order.status, nextStatus)) return { ok: false, terminal: "rejected" };
  if (orderVersionOf(order) !== proposal.expectedVersion) return { ok: false, terminal: "stale" };
  return { ok: true, order, nextStatus };
};

// Applies the ONE exact stored fulfillment transition inside the same
// transaction as the proposal claim: a single conditional order update setting
// the status and backfilling the single stage timestamp field, guarded on the
// immutable attribution AND the exact status + updatedAt the revalidation read
// (the closest an order without a version column gets to a compare-and-swap).
// A concurrent storefront transition between the fresh read and this write
// counts 0 and throws, rolling the whole transaction (claim included) back so
// the proposal stays pending and a retry re-runs every check — the same
// lost-race semantics as the #24 cancellation and #27 price paths. It NEVER
// sends the buyer notification email the storefront flow sends inline and
// never writes a notification, payment, refund, revenue, or stock change: the
// disclosure on the proposal says exactly that.
export const applyFulfillmentTransition = async (tx, { order, nextStatus, accountId, now }) => {
  const timestampField = stageTimestampFieldFor(nextStatus);
  const applied = await tx.order.updateMany({
    where: {
      id: order.id,
      sellerIdAtPurchase: accountId,
      status: order.status,
      updatedAt: order.updatedAt,
    },
    data: {
      status: nextStatus,
      [timestampField]: order[timestampField] || now,
    },
  });
  if (applied.count !== 1) {
    throw Object.assign(
      new Error("Order state changed; the fulfillment step was not applied"),
      { statusCode: 409, code: "order_state_changed" },
    );
  }
};
