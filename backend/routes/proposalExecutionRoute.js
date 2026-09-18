// First-party proposal review + execution API (#22, extended by #24).
//
// Mounted at /api/v1/proposals in app.js — deliberately AFTER the global
// rejectDelegatedTokens middleware, so delegated assistant tokens are rejected
// on every route here, and guarded by the normal browser verifyToken middleware
// (the same short-lived JWT access token the storefront routes use; refresh
// tokens are never accepted and there is no delegated fallback). The MCP
// surface can only create and read proposals; moving a proposal out of pending
// and mutating the cart or order happens exclusively through this
// browser-session path.
//
// Exactly-once design: every terminal transition is a conditional
//   UPDATE proposals SET status=... WHERE id=? AND subject_id=? AND status='pending'
// inside the same transaction as the cart/order mutation and the outbox insert.
// Concurrent confirmations serialize on that row update: the winner's
// transaction commits (one mutation, one outbox row), the loser's UPDATE
// re-evaluates status after the winner commits and counts 0, so the loser
// simply replays the winner's stored deterministic outcome. The execution
// reference is the deterministic string proposal-exec-<proposalId> (never a
// credential). Cart responses report expectedVersion + 1 (every cart mutation
// bumps the version by exactly one); order.cancel responses report the stored
// target and the cancelled status, which are immutable on the proposal row.
//
// order.cancel (#24): execution reauthorizes the owner, rechecks the current
// eligibility and the orderVersionOf(order) proxy against expectedVersion
// (mismatch ⇒ stale, 409, no mutation), and performs the cancellation inline
// with the SAME semantics as cancelOrderCore — owner-conditional, optimistic
// status-conditional update, stock restored ONLY from "Confirmed". It NEVER
// invokes releaseRefund, any payment/refund provider, or any refund/revenue/
// payment/notification write: refund release remains a separate manual admin
// action. Orders carry no version column, so expectedVersion is the
// orderVersionOf(order.updatedAt) epoch-seconds proxy documented in
// services/assistantCancellationProposals.js.
import express from "express";

import { verifyToken } from "../middlewares/authMiddleware.js";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { listPriceWithOptions } from "../utils/productPricing.js";
import { isDelegatedTokenShape } from "../utils/mcpOAuth.js";
import { adjustStock, isCancelEligible } from "../controller/order.js";
import { orderVersionOf } from "../services/assistantCancellationProposals.js";
import { sanitizeVariants } from "../services/assistantCart.js";
import {
  RETURN_ACTION_KIND,
  RETURN_DISCLOSURES,
  RETURN_NEXT_STEPS,
  applyReturnRequest,
  revalidateReturnForExecution,
} from "../services/assistantReturnProposals.js";

export const PROPOSAL_LIST_LIMIT = 20;

const DISCLOSURES = Object.freeze({
  "cart.add_item": Object.freeze([
    "Adds the reviewed product to your cart",
    "No payment is taken",
  ]),
  "cart.update_quantity": Object.freeze([
    "Changes your cart quantities",
    "No payment is taken",
  ]),
  "cart.remove_item": Object.freeze([
    "Removes the reviewed item from your cart",
    "No payment is taken",
  ]),
  // Buyer return proposals (#25): disclosures live in the return service so the
  // proposal preview and this review screen stay identical.
  [RETURN_ACTION_KIND]: RETURN_DISCLOSURES,
});

const PROPOSAL_SELECT = {
  id: true,
  subjectId: true,
  role: true,
  actionKind: true,
  targetType: true,
  targetId: true,
  status: true,
  expectedVersion: true,
  expiresAt: true,
  executedAt: true,
  createdAt: true,
  canonicalPayload: true,
  payloadHash: true,
  executionReference: true,
};

const executionReferenceFor = (proposalId) => `proposal-exec-${proposalId}`;

const effectiveStatus = (proposal, now) => {
  if (proposal.status === "pending" && proposal.expiresAt.getTime() <= now.getTime()) return "expired";
  return proposal.status;
};

// Defense in depth next to the app-level rejectDelegatedTokens placement.
const rejectDelegatedMiddleware = async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && isDelegatedTokenShape(token)) {
    return res.status(403).json({ code: "delegated_not_allowed", message: "Delegated tokens are assistant-only" });
  }
  return next();
};

const transitionPending = (tx, id, subjectId, data) =>
  tx.proposal.updateMany({ where: { id, subjectId, status: "pending" }, data });

const writeOutbox = (tx, proposalId, eventType, payloadHash) =>
  tx.proposalOutboxEvent.create({ data: { proposalId, eventType, payloadHash } });

const reloadProposal = async (tx, id) =>
  tx.proposal.findUnique({ where: { id }, select: PROPOSAL_SELECT });

// Deterministic executed response per action kind, built only from stored
// proposal fields so a retry after success replays it byte-identically.
const executedResponseFor = (proposal) => {
  if (proposal.actionKind === "order.cancel") {
    return {
      status: "executed",
      executionReference: proposal.executionReference ?? executionReferenceFor(proposal.id),
      orderId: proposal.targetId,
      orderStatus: "Cancelled",
    };
  }
  return {
    status: "executed",
    executionReference: proposal.executionReference ?? executionReferenceFor(proposal.id),
    cartVersion: proposal.expectedVersion + 1,
  };
};

// Deterministic outcome for any proposal that has already left pending.
const resolveTerminal = (proposal) => {
  if (proposal.status === "executed") {
    return {
      kind: "executed",
      response: executedResponseFor(proposal),
    };
  }
  const reason = proposal.status === "expired"
    ? "expired"
    : proposal.status === "stale"
      ? "stale"
      : proposal.status === "rejected"
        ? "rejected"
        : "expired"; // unreachable defensive default
  return { kind: "blocked", reason };
};

const cartTotals = (cartRow) =>
  cartRow.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

// Applies the exact stored canonical action to the cart. Only server-side state
// and the stored payload are consulted — the HTTP request body of the execute
// call carries nothing, so a substituted payload can never reach the cart.
const applyStoredAction = async (tx, { payload, cart, account, product, item }) => {
  let cartId = cart?.id ?? null;

  if (payload.action === "add_item") {
    // Same sanitized-variant comparison the proposal preview used, so the
    // merge decision at execution matches the previewed "after" exactly.
    const variants = sanitizeVariants(payload.options ?? {});
    const linePrice = listPriceWithOptions(product, variants);
    if (!cartId) {
      const created = await tx.cart.create({
        data: {
          id: generateId(),
          userId: account.id,
          email: account.email,
          items: {
            create: [{ productId: payload.productId, quantity: payload.quantity, price: linePrice, variants }],
          },
        },
        include: { items: true },
      });
      cartId = created.id;
    } else {
      const rows = await tx.cartItem.findMany({ where: { cartId, productId: payload.productId } });
      const matching = rows.find((row) => JSON.stringify(sanitizeVariants(row.variants)) === JSON.stringify(variants));
      if (matching) {
        await tx.cartItem.update({ where: { id: matching.id }, data: { quantity: matching.quantity + payload.quantity } });
      } else {
        await tx.cartItem.create({
          data: { cartId, productId: payload.productId, quantity: payload.quantity, price: linePrice, variants },
        });
      }
    }
  } else if (payload.action === "update_quantity") {
    await tx.cartItem.update({ where: { id: item.id }, data: { quantity: payload.quantity } });
  } else {
    await tx.cartItem.delete({ where: { id: item.id } });
  }

  // Recompute the stored total exactly like the storefront controllers and bump
  // the optimistic version by exactly one (see module comment).
  const populated = await tx.cart.findUnique({ where: { id: cartId }, include: { items: true } });
  const totalPrice = cartTotals(populated);
  await tx.cart.update({
    where: { id: cartId },
    data: { totalPrice, updatedAt: new Date(), version: { increment: 1 } },
  });
};

// Applies the stored cancellation with cancelOrderCore semantics inside the
// same transaction as the proposal claim (#24): owner- and status-conditional
// optimistic claim (Cancelled + cancelledAt), then stock restored ONLY when
// the previewed status was "Confirmed" (Pending orders never had stock
// deducted), via the shared adjustStock helper so the restore is atomically
// identical to the storefront path. It NEVER touches payments, refunds,
// revenue, bills, notifications, or any provider: refund release stays a
// separate manual admin action. The conditional claim re-evaluates against the
// latest committed row, so a concurrent storefront cancellation between the
// fresh read and this update counts 0 and rolls the whole transaction back
// (the proposal stays pending and a retry resolves deterministically).
const applyOrderCancel = async (tx, { order, account, now }) => {
  const claim = await tx.order.updateMany({
    where: { id: order.id, userId: account.id, status: order.status },
    data: { status: "Cancelled", cancelledAt: now },
  });
  if (claim.count !== 1) {
    throw Object.assign(
      new Error("Order state changed; the cancellation was not applied"),
      { statusCode: 409, code: "order_state_changed" },
    );
  }
  if (order.status === "Confirmed") {
    await adjustStock(order.productId, order.quantity, order.variantColor, order.variantStorage, 1, tx);
  }
};

// Side-effect disclosures shown on the review screen. Cart kinds carry static
// lists; order.cancel replays the proposal's own immutable stored
// disclosedConsequences so the review list matches the preview exactly.
const disclosuresFor = (proposal) => {
  if (proposal.actionKind === "order.cancel") {
    const disclosed = proposal.preview?.disclosedConsequences;
    return Array.isArray(disclosed)
      ? disclosed.filter((entry) => typeof entry === "string").slice(0, 10)
      : [];
  }
  return DISCLOSURES[proposal.actionKind] ?? [];
};

export const getProposalReview = async (req, res, client = prisma) => {
  try {
    const now = new Date();
    const proposal = await client.proposal.findFirst({
      where: { id: req.params.id, subjectId: req.user.id },
      select: { ...PROPOSAL_SELECT, preview: true },
    });
    if (!proposal) {
      return res.status(404).json({ code: "not_found", message: "Resource not found" });
    }
    // The return reason is user-authored content stored in the canonical
    // payload, so the review screen must show it. It is bounded server-side and
    // never appears in cart or cancellation proposals or in any audit row.
    const storedReason = proposal.actionKind === RETURN_ACTION_KIND
      && proposal.canonicalPayload
      && typeof proposal.canonicalPayload.reason === "string"
      ? proposal.canonicalPayload.reason.slice(0, 1000)
      : null;
    return res.json({
      proposal: {
        id: proposal.id,
        actionKind: proposal.actionKind,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        status: effectiveStatus(proposal, now),
        expectedVersion: proposal.expectedVersion,
        expiresAt: proposal.expiresAt.toISOString(),
        createdAt: proposal.createdAt.toISOString(),
        preview: proposal.preview,
        reason: storedReason,
        disclosures: disclosuresFor(proposal),
      },
    });
  } catch (error) {
    console.error("Error loading proposal review:", error);
    return res.status(500).json({ code: "review_failed", message: "Proposal review failed" });
  }
};

export const listMyProposals = async (req, res, client = prisma) => {
  try {
    const now = new Date();
    const rows = await client.proposal.findMany({
      where: { subjectId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: PROPOSAL_LIST_LIMIT,
      select: { id: true, actionKind: true, status: true, expiresAt: true, createdAt: true, preview: true },
    });
    return res.json({
      proposals: rows.map((row) => ({
        id: row.id,
        actionKind: row.actionKind,
        status: effectiveStatus(row, now),
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        productName: typeof row.preview?.productName === "string" ? row.preview.productName.slice(0, 200) : null,
      })),
    });
  } catch (error) {
    console.error("Error listing proposals:", error);
    return res.status(500).json({ code: "list_failed", message: "Proposal list failed" });
  }
};

export const executeProposal = async (req, res, client = prisma) => {
  const now = new Date();
  const userId = req.user.id;
  try {
    const outcome = await client.$transaction(async (tx) => {
      // 1. Load the proposal. Foreign and missing ids are the identical 404.
      const proposal = await reloadProposal(tx, req.params.id);
      if (!proposal || proposal.subjectId !== userId) return { kind: "not_found" };

      // 2. A proposal that already left pending replays its first outcome.
      if (proposal.status !== "pending") return resolveTerminal(proposal);

      // 3. Expired: persist the transition exactly once, then report it.
      if (proposal.expiresAt.getTime() <= now.getTime()) {
        const claimed = await transitionPending(tx, proposal.id, userId, { status: "expired" });
        if (claimed.count === 1) await writeOutbox(tx, proposal.id, "expired", proposal.payloadHash);
        return resolveTerminal(await reloadProposal(tx, proposal.id));
      }

      // 4. Reauthorize the acting account: the browser session must still be
      //    the proposal subject with the role recorded at proposal time.
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, email: true },
      });
      if (!account) return { kind: "not_found" };
      if (account.role !== proposal.role) {
        const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
        if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
        return resolveTerminal(await reloadProposal(tx, proposal.id));
      }

      // 4a. order.return_request (#25): revalidate the live owned order against the
      //     current approved policy window and exact stored state (order moved on =>
      //     stale/rejected, no mutation), claim exactly once, apply the stored
      //     reason, and write the outbox event — all in this transaction. There is
      //     NO payment or refund call on this path: refunds stay a separate admin
      //     action, and evidence upload stays in ShopSphere's trusted flows.
      if (proposal.actionKind === RETURN_ACTION_KIND) {
        const revalidation = await revalidateReturnForExecution(tx, { proposal, account, now });
        if (!revalidation.ok) {
          const claimed = await transitionPending(tx, proposal.id, userId, { status: revalidation.terminal });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, revalidation.terminal, proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }
        const claimed = await transitionPending(tx, proposal.id, userId, {
          status: "executed",
          executedAt: now,
          executionReference: executionReferenceFor(proposal.id),
        });
        if (claimed.count !== 1) return resolveTerminal(await reloadProposal(tx, proposal.id));
        await applyReturnRequest(tx, { order: revalidation.order, proposal, now });
        await writeOutbox(tx, proposal.id, "executed", proposal.payloadHash);
        return {
          kind: "executed",
          executionReference: executionReferenceFor(proposal.id),
          nextSteps: [...RETURN_NEXT_STEPS],
        };
      }

      // 4b. order.cancel (#24): reauthorize the owned order, recheck the
      //     version proxy and current eligibility, then cancel inline with
      //     cancelOrderCore semantics and NO refund/payment interaction.
      if (proposal.actionKind === "order.cancel") {
        const payload = proposal.canonicalPayload;
        const order = await tx.order.findFirst({
          where: { id: typeof payload?.orderId === "string" ? payload.orderId : "", userId: account.id },
          select: {
            id: true,
            status: true,
            quantity: true,
            productId: true,
            variantColor: true,
            variantStorage: true,
            updatedAt: true,
          },
        });
        if (!order) {
          // The stored target no longer resolves to this owner under the
          // immutable attribution: the proposal can never be applied.
          const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }
        // Stale check: any committed change to the order since the preview
        // (status, money, anything touching the row) moves updatedAt.
        if (orderVersionOf(order) !== proposal.expectedVersion) {
          const claimed = await transitionPending(tx, proposal.id, userId, { status: "stale" });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, "stale", proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }
        // Business-rule revalidation on fresh state (defense in depth for
        // same-second version collisions).
        if (!isCancelEligible(order)) {
          const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }

        // Exactly-once claim (same as the cart path), then the inline
        // cancellation inside this same transaction.
        const claimed = await transitionPending(tx, proposal.id, userId, {
          status: "executed",
          executedAt: now,
          executionReference: executionReferenceFor(proposal.id),
        });
        if (claimed.count !== 1) return resolveTerminal(await reloadProposal(tx, proposal.id));

        await applyOrderCancel(tx, { order, account, now });
        await writeOutbox(tx, proposal.id, "executed", proposal.payloadHash);
        return { kind: "executed", response: executedResponseFor(proposal) };
      }

      // 5. Stale check: the cart must still be at the previewed version.
      const cart = await tx.cart.findFirst({
        where: { userId },
        select: { id: true, version: true, email: true },
      });
      if ((cart?.version ?? 0) !== proposal.expectedVersion) {
        const claimed = await transitionPending(tx, proposal.id, userId, { status: "stale" });
        if (claimed.count === 1) await writeOutbox(tx, proposal.id, "stale", proposal.payloadHash);
        return resolveTerminal(await reloadProposal(tx, proposal.id));
      }

      // 6. Business-rule revalidation against current state, using only the
      //    stored canonical payload.
      const payload = proposal.canonicalPayload;
      let product = null;
      let item = null;
      if (payload.action === "add_item") {
        product = await tx.product.findUnique({
          where: { id: payload.productId },
          include: { options: true },
        });
        if (!product || product.isArchived || (product.quantity ?? 0) <= 0) {
          const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }
      } else {
        item = cart
          ? await tx.cartItem.findFirst({ where: { id: payload.cartItemId, cartId: cart.id } })
          : null;
        if (!item) {
          const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
          if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
          return resolveTerminal(await reloadProposal(tx, proposal.id));
        }
      }

      // 7. Exactly-once claim: the conditional UPDATE serializes concurrent
      //    confirmations (see module comment). A count of 0 means another
      //    transaction just resolved this proposal; replay its outcome.
      const claimed = await transitionPending(tx, proposal.id, userId, {
        status: "executed",
        executedAt: now,
        executionReference: executionReferenceFor(proposal.id),
      });
      if (claimed.count !== 1) return resolveTerminal(await reloadProposal(tx, proposal.id));

      // 8. Apply the stored action, bump the cart version, and write the
      //    outbox event — all inside this same transaction.
      await applyStoredAction(tx, { payload, cart, account, product, item });
      await writeOutbox(tx, proposal.id, "executed", proposal.payloadHash);
      return { kind: "executed", response: executedResponseFor(proposal) };
    });

    if (outcome.kind === "not_found") {
      return res.status(404).json({ code: "not_found", message: "Resource not found" });
    }
    if (outcome.kind === "executed") {
      const body = outcome.response ?? {
        status: "executed",
        executionReference: outcome.executionReference,
        ...(outcome.cartVersion !== undefined ? { cartVersion: outcome.cartVersion } : {}),
        ...(outcome.nextSteps !== undefined ? { nextSteps: outcome.nextSteps } : {}),
      };
      return res.json(body);
    }
    return res.status(409).json({
      code: "proposal_not_executable",
      reason: outcome.reason,
      message: "Proposal is no longer executable",
    });
  } catch (error) {
    if (error?.code === "order_state_changed") {
      // The transaction (including the proposal claim) rolled back: the
      // proposal is still pending and a retry re-runs every check against the
      // current order state. Never a partial cancellation.
      return res.status(409).json({
        code: "order_state_changed",
        message: "Order state changed; the cancellation was not applied",
      });
    }
    console.error("Error executing proposal:", error);
    return res.status(500).json({ code: "execution_failed", message: "Proposal execution failed" });
  }
};

export const createProposalExecutionRouter = ({ authenticate = verifyToken, client = prisma } = {}) => {
  const router = express.Router();
  // Short-lived browser access token only (existing JWT TTL): no refresh-token
  // grant, no delegated assistant token, no confirmation-flag shortcut.
  router.use(rejectDelegatedMiddleware);
  router.get("/", authenticate, (req, res) => listMyProposals(req, res, client));
  router.get("/:id", authenticate, (req, res) => getProposalReview(req, res, client));
  router.post("/:id/execute", authenticate, (req, res) => executeProposal(req, res, client));
  return router;
};

export default createProposalExecutionRouter();
