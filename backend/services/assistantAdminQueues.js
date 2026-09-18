// Admin support queues for issue #17: bounded, redacted operational views.
// Membership is a fixed server rule — the exact stored exception/return status
// strings plus failed refunds, inside a rolling 90-day window — never a
// caller-supplied database filter: the only inputs are pagination bounds and,
// for the detail view, the audited support purpose. Rows whose buyer AND
// seller-at-purchase attribution are both NULL (ambiguous legacy rows) are
// quarantined from every queue. Customer and seller identity leave only as
// deterministic opaque references; names, emails, addresses, payment payloads,
// provider credentials, and the return-image path are never selected for
// output (the image column is read solely to compute a boolean presence flag).
// Every status leaves exactly as stored, so admin output can never
// misrepresent database state. Money uses exact integer-paisa arithmetic.
import crypto from "node:crypto";

import { createCursorCodec } from "./assistantCursor.js";
import { money, toCents } from "./assistantMoney.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ORDER_NUMBER_CHARS = 100;
const MAX_RETURN_REASON_CHARS = 1000;
const MAX_PURPOSE_CHARS = 500;

// Exact stored server status strings (storefront writes these with spaces).
// Refunds are only created against "Return Approved" or "Cancelled" orders and
// a failed refund leaves that status untouched, so refund-failed rows can sit
// at "Cancelled" — hence it joins the exception queue's closed status set.
export const EXCEPTION_STATUSES = Object.freeze([
  "Return Requested",
  "Return Approved",
  "Return Rejected",
  "Refund Released",
]);

// The return queue tracks orders still inside the return lifecycle.
// "Refund Released" is a refund-ledger terminal state — the return is finished
// and stays in the exception queue only.
export const RETURN_STATUSES = Object.freeze([
  "Return Requested",
  "Return Approved",
  "Return Rejected",
]);

export const REFUND_FAILED_STATUS = "Failed";

const exceptionCursor = createCursorCodec({ operation: "support.orderExceptionQueue" });
const returnCursor = createCursorCodec({ operation: "support.returnQueue" });

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

// Opaque, stable party references (deterministic truncated digests). They let
// support correlate repeat buyers/sellers without disclosing names, emails, or
// raw account ids. The null branches are defense in depth: ambiguous rows are
// quarantined by the queue predicates anyway.
const opaqueReference = (prefix, namespace, id) => (id
  ? `${prefix}-${crypto.createHash("sha256").update(`${namespace}:${id}`).digest("hex").slice(0, 12)}`
  : null);
const buyerReference = (userId) => opaqueReference("buyer", "shopsphere-buyer", userId);
const sellerReference = (sellerIdAtPurchase) => opaqueReference("seller", "shopsphere-seller", sellerIdAtPurchase);

const moneyOf = (value) => money(toCents(value?.toString?.() ?? String(value)));

const iso = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);

const STAMP_FIELDS = Object.freeze([
  "createdAt",
  "confirmedAt",
  "processingAt",
  "shippedAt",
  "deliveredAt",
  "cancelledAt",
  "returnRequestedAt",
  "refundReleasedAt",
]);

const lastTransitionAt = (row) => {
  let latest = null;
  for (const field of STAMP_FIELDS) {
    const value = row[field];
    if (value instanceof Date && !Number.isNaN(value.getTime()) && (!latest || value > latest)) latest = value;
  }
  return iso(latest);
};

const boundedText = (value, max) => (typeof value === "string" && value ? value.slice(0, max) : null);

// Hand-written projections: attribution columns are read for reference
// derivation only and never projected. Emails, names, delivery addresses,
// promo linkage, and payment payloads do not appear anywhere.
const refundTake = {
  select: { status: true, amount: true },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 1,
};

const queueSelect = {
  id: true,
  orderNumber: true,
  status: true,
  createdAt: true,
  userId: true,
  sellerIdAtPurchase: true,
  returnRequestedAt: true,
  refundReleasedAt: true,
  confirmedAt: true,
  processingAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  refunds: refundTake,
};

const detailSelect = {
  ...queueSelect,
  quantity: true,
  totalPrice: true,
  adminCommission: true,
  returnReason: true,
};

// returnImage is read to compute the hasReturnImage boolean only; the stored
// upload path is dropped inside the mapper and never serialized.
const returnSelect = {
  ...queueSelect,
  returnReason: true,
  returnImage: true,
};

// Fixed membership fragments. The queue can never be widened by an input.
const exceptionMembership = () => ({
  OR: [
    { status: { in: [...EXCEPTION_STATUSES] } },
    { refunds: { some: { status: REFUND_FAILED_STATUS } } },
  ],
});

// Ambiguous legacy rows (NULL buyer AND NULL seller attribution) match neither
// branch and are quarantined by predicate shape.
const attributionPresent = () => ({
  OR: [
    { userId: { not: null } },
    { sellerIdAtPurchase: { not: null } },
  ],
});

const minimizeQueueRow = (row) => {
  const refund = row.refunds?.[0] ?? null;
  return {
    orderId: row.id,
    orderNumber: boundedText(row.orderNumber, MAX_ORDER_NUMBER_CHARS),
    status: row.status,
    returnRequestedAt: iso(row.returnRequestedAt),
    refundStatus: refund?.status ?? null,
    refundAmount: refund ? moneyOf(refund.amount) : null,
    buyerReference: buyerReference(row.userId),
    sellerReference: sellerReference(row.sellerIdAtPurchase),
    lastTransitionAt: lastTransitionAt(row),
  };
};

const minimizeDetail = (row) => ({
  ...minimizeQueueRow(row),
  quantity: row.quantity,
  totalPrice: moneyOf(row.totalPrice),
  adminCommission: row.adminCommission == null ? null : moneyOf(row.adminCommission),
  confirmedAt: iso(row.confirmedAt),
  processingAt: iso(row.processingAt),
  shippedAt: iso(row.shippedAt),
  deliveredAt: iso(row.deliveredAt),
  cancelledAt: iso(row.cancelledAt),
  returnReason: boundedText(row.returnReason, MAX_RETURN_REASON_CHARS),
  refundReleasedAt: iso(row.refundReleasedAt),
});

const minimizeReturnRow = (row) => {
  const refund = row.refunds?.[0] ?? null;
  return {
    orderId: row.id,
    orderNumber: boundedText(row.orderNumber, MAX_ORDER_NUMBER_CHARS),
    status: row.status,
    returnRequestedAt: iso(row.returnRequestedAt),
    returnReason: boundedText(row.returnReason, MAX_RETURN_REASON_CHARS),
    buyerReference: buyerReference(row.userId),
    sellerReference: sellerReference(row.sellerIdAtPurchase),
    hasReturnImage: Boolean(row.returnImage),
    refundStatus: refund?.status ?? null,
  };
};

const parsePage = (input) => ({
  limit: Math.min(Math.max(1, input?.limit ?? DEFAULT_LIMIT), MAX_LIMIT),
});

// Shared bounded-page reader: newest first, rolling 90-day window enforced
// server-side, HMAC cursor bound to the admin principal + query. The window is
// pinned inside the cursor state so paginating cannot silently shift rows.
const readQueuePage = async ({ input, client, principal, cursorSecret, now, codec, membership, select, minimize }) => {
  const limit = parsePage(input).limit;
  const query = { limit };
  const position = codec.decode(input?.cursor, principal, query, cursorSecret);
  const state = position?.state ?? null;
  if (input?.cursor && (
    typeof state?.from !== "string"
    || typeof state?.to !== "string"
    || Number.isNaN(Date.parse(state.from))
    || Number.isNaN(Date.parse(state.to))
  )) throw notFound();
  const to = state ? new Date(state.to) : now;
  const from = state ? new Date(state.from) : new Date(to.getTime() - MAX_INTERVAL_MS);
  const rows = await client.order.findMany({
    where: {
      AND: [
        { createdAt: { gte: from, lte: to } },
        membership(),
        attributionPresent(),
        ...(position ? [{
          OR: [
            { createdAt: { lt: new Date(position.createdAt) } },
            { createdAt: new Date(position.createdAt), id: { lt: position.id } },
          ],
        }] : []),
      ],
    },
    select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    rows: page.map(minimize),
    nextCursor: rows.length > limit
      ? codec.encode(page.at(-1), principal, query, cursorSecret, { from: from.toISOString(), to: to.toISOString() })
      : null,
  };
};

export const listOrderExceptionQueue = async (
  { cursor, limit } = {},
  { client, principal, cursorSecret, now = new Date() },
) => {
  const page = await readQueuePage({
    input: { cursor, limit },
    client,
    principal,
    cursorSecret,
    now,
    codec: exceptionCursor,
    membership: exceptionMembership,
    select: queueSelect,
    minimize: minimizeQueueRow,
  });
  return { orders: page.rows, nextCursor: page.nextCursor };
};

// The purpose is admin-supplied bounded text and the explicit "why" of this
// access. It is threaded through the route's observe() seam into the durable
// audit event's redacted input metadata (never into the tool response).
export const orderExceptionDetailObserve = (output, input) => ({
  resourceIds: [output.order.orderId],
  rowCount: 1,
  auditMetadata: { purpose: String(input?.purpose ?? "").slice(0, MAX_PURPOSE_CHARS) },
});

export const getOrderExceptionDetail = async (
  { orderId, purpose },
  { client, principal, now = new Date() },
) => {
  if (!principal?.subject) throw notFound();
  if (typeof orderId !== "string" || !orderId || orderId.length > 100) throw notFound();
  if (typeof purpose !== "string" || purpose.trim().length < 10 || purpose.length > MAX_PURPOSE_CHARS) {
    throw badInput("purpose must be 10 to 500 characters");
  }
  // Same fixed membership rule as the queue, including the rolling 90-day
  // window: every read stays bounded by it. A foreign id, a missing id, an
  // out-of-window order, and a well-formed but non-queued order all resolve to
  // the identical generic 404 with no existence leak. Ownership context is the
  // stored order row itself; product ownership is never consulted.
  const row = await client.order.findFirst({
    where: {
      AND: [
        { id: orderId },
        { createdAt: { gte: new Date(now.getTime() - MAX_INTERVAL_MS), lte: now } },
        exceptionMembership(),
        attributionPresent(),
      ],
    },
    select: detailSelect,
  });
  if (!row) throw notFound();
  return { order: minimizeDetail(row) };
};

export const listReturnQueue = async (
  { cursor, limit } = {},
  { client, principal, cursorSecret, now = new Date() },
) => {
  const membership = () => ({
    AND: [
      { status: { in: [...RETURN_STATUSES] } },
      { returnRequestedAt: { not: null } },
    ],
  });
  const page = await readQueuePage({
    input: { cursor, limit },
    client,
    principal,
    cursorSecret,
    now,
    codec: returnCursor,
    membership,
    select: returnSelect,
    minimize: minimizeReturnRow,
  });
  return { returns: page.rows, nextCursor: page.nextCursor };
};
