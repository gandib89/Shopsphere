// Buyer order-cancellation proposals for #24, on the shared proposal platform
// from #22.
//
// proposeOrderCancellation persists ONLY a proposal row (plus one "created"
// outbox event, exactly like proposeCartChange): it never mutates the order,
// stock, payments, refunds, bills, notifications, or emails, and it never
// calls any payment/refund provider. The preview is the exact server-computed
// snapshot of the owned order at propose time — eligibility is re-derived from
// stored state, stock restoration is computed from the same rule the
// storefront cancellation uses (restore ONLY from "Confirmed"; "Pending"
// orders never had stock deducted), and the disclosed follow-up consequences
// are fixed server strings (refund release is a separate manual admin action
// and is never initiated here).
//
// Error semantics (documented design): a foreign or missing orderId is the
// identical generic 404 via the immutable buildBuyerOrderWhere predicate
// (never an existence leak). An OWNED but ineligible order (e.g. Shipped,
// Cancelled, Refund Released) creates NO proposal and fails with a
// deterministic statusCode 400 — the assistant route's fixed mapping answers
// the generic 400 invalid_input body, which keeps the failure bounded and
// deterministic; 404 stays reserved exclusively for foreign/missing identity.
//
// Version semantics: orders carry no version column, so expectedVersion is a
// hash-string-safe integer proxy derived from current state (see
// orderVersionOf). Propose and execute derive it with the same helper, so any
// committed order change after the preview makes the proposal stale at
// execution.
//
// Both operations run inside withAssistantActor as
// shopsphere_assistant_private_runtime: the RLS policies key rows on the actor
// GUCs, so the subject scoping below is defense in depth, not the only gate.
import crypto from "node:crypto";

import { isCancelEligible } from "../controller/order.js";
import { money, toCents } from "./assistantMoney.js";
import { buildBuyerOrderWhere } from "./orderOwnership.js";
import { generateId } from "../utils/generateId.js";

export const PROPOSAL_TTL_MS = 10 * 60 * 1000; // exactly ten minutes

export const CANCELLATION_ACTION_KIND = "order.cancel";

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
// Owned-but-ineligible is a deterministic business denial, not an identity
// leak: it never merges with the 404 path. See the module comment.
const notCancellable = () =>
  Object.assign(new Error("Order cannot be cancelled"), { statusCode: 400, code: "order_not_cancellable" });

export const canonicalPayloadHash = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

// Optimistic-concurrency proxy for orders, which have no version column.
// expectedVersion stores the order row's updatedAt as epoch SECONDS: epoch
// milliseconds would overflow the proposals."expectedVersion" 32-bit integer
// column, while seconds stay int4-safe. Propose and execution derive it with
// this same helper; any committed order mutation bumps updatedAt, so a
// mismatch at execution means the world moved after the preview and the
// proposal goes stale. Two mutations inside the same wall-clock second remain
// indistinguishable by design — the execution path still re-checks
// eligibility from fresh state and claims the order with a status-conditional
// update, so no collision can double-cancel or clobber concurrent changes.
export const orderVersionOf = (order) => {
  const updatedAt = order?.updatedAt instanceof Date ? order.updatedAt : new Date(order?.updatedAt);
  const ms = updatedAt.getTime();
  if (Number.isNaN(ms)) throw Object.assign(new Error("Order has no usable updatedAt"), { statusCode: 500 });
  return Math.floor(ms / 1000);
};

// Fixed follow-up disclosures. The stock-restoration line carries the exact
// server-computed count (0 for Pending — nothing was ever deducted); the
// refund line is the platform promise that money movement never rides on this
// proposal or its execution.
const disclosedConsequencesFor = (stockToRestore) => [
  "Cancels the order",
  `Restores ${stockToRestore} item(s) to stock`,
  "Any refund is a separate manual admin action and is NOT initiated here",
];

const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  quantity: true,
  productId: true,
  variantColor: true,
  variantStorage: true,
  updatedAt: true,
};

export const proposeOrderCancellation = async (input, { client, principal, now = new Date() }) => {
  // Read-only owned-order load. The predicate is the immutable userId
  // attribution only (never email, never a storefront fallback): foreign and
  // missing ids are the identical 404.
  const order = await client.order.findFirst({
    where: buildBuyerOrderWhere(principal.subject, { id: input.orderId }),
    select: orderSelect,
  });
  if (!order) throw notFound();
  // Only an eligible owned order can produce a bounded proposal. Ineligible
  // orders fail deterministically before anything is persisted.
  if (!isCancelEligible(order)) throw notCancellable();

  // Exact state snapshot. stockToRestore follows cancelOrderCore's rule:
  // stock is restored ONLY when the status was "Confirmed" (Pending orders
  // never had stock deducted), so a Pending cancellation restores 0.
  const stockToRestore = order.status === "Confirmed" ? order.quantity : 0;
  // A succeeded payment is disclosed as the exact-decimal NPR amount so the
  // buyer can anticipate the manual refund conversation; no refund row,
  // status, gateway reference, or provider data is read or exposed.
  const succeededPayment = await client.payment.findFirst({
    where: { orderId: order.id, order: { userId: principal.subject }, status: "Succeeded" },
    select: { status: true, amount: true },
  });
  const paidAmount = succeededPayment
    ? money(toCents(succeededPayment.amount?.toString?.() ?? String(succeededPayment.amount)))
    : null;

  const preview = {
    actionKind: CANCELLATION_ACTION_KIND,
    currency: "NPR",
    orderId: order.id,
    orderNumber: order.orderNumber ? String(order.orderNumber).slice(0, 100) : null,
    currentStatus: order.status,
    cancelEligible: true,
    stockToRestore,
    paidAmount,
    disclosedConsequences: disclosedConsequencesFor(stockToRestore),
  };

  const payloadHash = canonicalPayloadHash(input);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);
  const id = generateId();

  await client.proposal.create({
    data: {
      id,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind: CANCELLATION_ACTION_KIND,
      targetType: "order",
      targetId: order.id,
      canonicalPayload: input,
      preview,
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
