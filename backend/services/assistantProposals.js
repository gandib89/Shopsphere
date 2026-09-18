// Canonical cart-change proposal platform (#22).
//
// proposeCartChange persists ONLY a proposal row (plus one "created" outbox
// event): it never mutates cart_items, carts, orders, stock, notifications, or
// emails. The before/after preview is recomputed server-side with the exact
// assistantCart.js pricing helpers (integer paisa math via assistantMoney.js);
// stored totals are never trusted and caller totals cannot exist in the input.
//
// getMyActionStatus answers strictly-owned proposal status (subject AND grant
// must match; foreign and missing ids are the identical 404) and never returns
// the payload, preview, execution reference, or any approver/credential data.
//
// Both operations run inside withAssistantActor as shopsphere_assistant_private_runtime:
// the RLS policy keys rows on the actor GUCs, so the subject scoping below is
// defense in depth, not the only gate.
import crypto from "node:crypto";

import { buildItems, listUnitCents, sanitizeVariants } from "./assistantCart.js";
import { money, percentOffCents } from "./assistantMoney.js";
import { generateId } from "../utils/generateId.js";

export const PROPOSAL_TTL_MS = 10 * 60 * 1000; // exactly ten minutes

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });

export const canonicalPayloadHash = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const optionSelect = { kind: true, value: true, priceDelta: true };

const productSelect = {
  id: true,
  name: true,
  price: true,
  images: true,
  category: true,
  discount: true,
  quantity: true,
  isArchived: true,
  options: { select: optionSelect },
};

const cartSelect = {
  id: true,
  userId: true,
  version: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      variants: true,
      product: { select: productSelect },
    },
  },
};

const availabilityOf = (product) => {
  if (!product || product.isArchived) return "Unavailable";
  return (product.quantity ?? 0) > 0 ? "In stock" : "Sold out";
};

// Line math for one cart row, matching buildItems exactly (archived/unavailable
// lines contribute zero, unknown variants contribute nothing to the unit price).
const lineOf = (row) => {
  const product = row.product;
  if (!product || product.isArchived) {
    return { quantity: row.quantity, unitCents: 0, lineCents: 0 };
  }
  const unit = percentOffCents(listUnitCents(product, sanitizeVariants(row.variants)), product.discount ?? "0");
  return { quantity: row.quantity, unitCents: unit, lineCents: unit * row.quantity };
};

const lineProjection = (line) => ({
  quantity: line ? line.quantity : null,
  unitPrice: line ? money(line.unitCents) : null,
  lineTotal: line ? money(line.lineCents) : null,
});

const previewOf = ({ actionKind, product, beforeLine, afterLine, beforeTotalCents, afterTotalCents }) => ({
  actionKind,
  currency: "NPR",
  productName: String(product?.name ?? "Unavailable product").slice(0, 200),
  availability: availabilityOf(product),
  before: { ...lineProjection(beforeLine), cartSubtotal: money(beforeTotalCents) },
  after: { ...lineProjection(afterLine), cartSubtotal: money(afterTotalCents) },
});

export const proposeCartChange = async (input, { client, principal, now = new Date() }) => {
  const actionKind = `cart.${input.action}`;
  // Read-only cart load (RLS-scoped to the actor); no cart write happens here.
  const cart = await client.cart.findFirst({
    where: { userId: principal.subject },
    select: cartSelect,
  });
  const rows = cart?.items ?? [];

  let product = null;
  let targetType;
  let targetId = null;
  let beforeLine = null;
  let afterLine = null;
  let afterRows;

  if (input.action === "add_item") {
    product = await client.product.findUnique({ where: { id: input.productId }, select: productSelect });
    if (!product) throw notFound();
    targetType = "cart";
    const variants = sanitizeVariants(input.options ?? {});
    // add_item onto an identical existing line merges, exactly as the
    // storefront addToCart does, so the preview shows the merged line.
    const existingRow = rows.find(
      (row) =>
        row.productId === product.id
        && JSON.stringify(sanitizeVariants(row.variants)) === JSON.stringify(variants),
    );
    const afterRow = existingRow
      ? { ...existingRow, quantity: existingRow.quantity + input.quantity }
      : { productId: product.id, quantity: input.quantity, variants, product };
    beforeLine = existingRow ? lineOf(existingRow) : null;
    afterLine = lineOf(afterRow);
    afterRows = existingRow
      ? rows.map((row) => (row.id === existingRow.id ? afterRow : row))
      : [...rows, afterRow];
  } else {
    // update_quantity / remove_item target an owned cart line by id; a foreign
    // or unknown cart item is the identical 404.
    const targetRow = rows.find((row) => row.id === input.cartItemId);
    if (!targetRow) throw notFound();
    product = targetRow.product;
    targetType = "cart_item";
    targetId = input.cartItemId;
    beforeLine = lineOf(targetRow);
    if (input.action === "update_quantity") {
      const afterRow = { ...targetRow, quantity: input.quantity };
      afterLine = lineOf(afterRow);
      afterRows = rows.map((row) => (row.id === targetRow.id ? afterRow : row));
    } else {
      // The line is gone: quantity/unit/lineTotal honestly null in "after".
      afterRows = rows.filter((row) => row.id !== targetRow.id);
    }
  }

  // Cart subtotal = exact server-recomputed sum of discounted line totals (the
  // same integer-paisa totalCents that previewCheckout reports). before and
  // after are computed from the same row builder, so they can never diverge
  // from a later cart read at the same version.
  const beforeTotals = buildItems(rows);
  const afterTotals = buildItems(afterRows);
  const preview = previewOf({
    actionKind,
    product,
    beforeLine,
    afterLine,
    beforeTotalCents: beforeTotals.totalCents,
    afterTotalCents: afterTotals.totalCents,
  });

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
      actionKind,
      targetType,
      targetId,
      canonicalPayload: input,
      preview,
      expectedVersion: cart?.version ?? 0,
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

// Deterministic coarse reason for a terminal status. The detailed reason is
// shown once, synchronously, by the first-party execute endpoint; the MCP
// status surface only gets this bounded classification. The stale reason names
// what moved on: the cart version for cart proposals, the order state for
// return proposals (#25).
const outcomeReasonFor = (status, actionKind) => {
  if (status === "expired") return "expired";
  if (status === "stale") return actionKind === "order.return_request" ? "order_state_changed" : "cart_version_changed";
  if (status === "rejected") return "revalidation_failed";
  return null;
};

export const getMyActionStatus = async (input, { client, principal, now = new Date() }) => {
  const proposal = await client.proposal.findFirst({
    where: { id: input.proposalId, subjectId: principal.subject, grantId: principal.grantId },
    select: {
      id: true,
      actionKind: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      executedAt: true,
    },
  });
  if (!proposal) throw notFound();

  // The private runtime has no UPDATE grant, so expiry is derived, not written;
  // the first-party execute path persists the same transition when it runs.
  let status = proposal.status;
  if (status === "pending" && proposal.expiresAt.getTime() <= now.getTime()) status = "expired";

  return {
    proposalId: proposal.id,
    actionKind: proposal.actionKind,
    status,
    createdAt: proposal.createdAt.toISOString(),
    expiresAt: proposal.expiresAt.toISOString(),
    executedAt: proposal.executedAt ? proposal.executedAt.toISOString() : null,
    outcomeReason: outcomeReasonFor(status, proposal.actionKind),
  };
};
