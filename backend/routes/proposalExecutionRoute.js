// First-party proposal review + execution API (#22).
//
// Mounted at /api/v1/proposals in app.js — deliberately AFTER the global
// rejectDelegatedTokens middleware, so delegated assistant tokens are rejected
// on every route here, and guarded by the normal browser verifyToken middleware
// (the same short-lived JWT access token the storefront routes use; refresh
// tokens are never accepted and there is no delegated fallback). The MCP
// surface can only create and read proposals; moving a proposal out of pending
// and mutating the cart happens exclusively through this browser-session path.
//
// Exactly-once design: every terminal transition is a conditional
//   UPDATE proposals SET status=... WHERE id=? AND subject_id=? AND status='pending'
// inside the same transaction as the cart mutation and the outbox insert.
// Concurrent confirmations serialize on that row update: the winner's
// transaction commits (one cart mutation, one outbox row), the loser's UPDATE
// re-evaluates status after the winner commits and counts 0, so the loser
// simply replays the winner's stored deterministic outcome. The execution
// reference is the deterministic string proposal-exec-<proposalId> (never a
// credential) and the reported cart version is expectedVersion + 1, because
// execution only proceeds when cart.version === expectedVersion and every
// mutation bumps the version by exactly one — so retries after success return
// the identical response.
import express from "express";

import { verifyToken } from "../middlewares/authMiddleware.js";
import { prisma } from "../database/prismaClient.js";
import { generateId } from "../utils/generateId.js";
import { listPriceWithOptions } from "../utils/productPricing.js";
import { isDelegatedTokenShape } from "../utils/mcpOAuth.js";
import { sanitizeVariants } from "../services/assistantCart.js";
import {
  LISTING_CONTENT_CHANGE_ACTION_KIND,
  LISTING_CONTENT_CHANGE_DISCLOSURES,
  LISTING_PUBLISH_ACTION_KIND,
  LISTING_PUBLISH_DISCLOSURES,
  listingProductVersionOf,
} from "../services/assistantListingProposals.js";

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
  // Listing proposals (#26). The exact same fixed strings the MCP preview
  // disclosed, so the browser review never shows a different story.
  [LISTING_PUBLISH_ACTION_KIND]: LISTING_PUBLISH_DISCLOSURES,
  [LISTING_CONTENT_CHANGE_ACTION_KIND]: LISTING_CONTENT_CHANGE_DISCLOSURES,
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

// Deterministic outcome for any proposal that has already left pending.
// cartVersion is a cart-flow concept (expectedVersion + 1, see the module
// comment): listing proposals (#26) report the execution reference only.
const resolveTerminal = (proposal) => {
  if (proposal.status === "executed") {
    return {
      kind: "executed",
      executionReference: proposal.executionReference ?? executionReferenceFor(proposal.id),
      ...(proposal.actionKind.startsWith("cart.") ? { cartVersion: proposal.expectedVersion + 1 } : {}),
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

// Applies the exact stored listing action (#26). Only server-side state and
// the stored canonical payload are consulted — the HTTP request body of the
// execute call carries nothing, so substituted content can never reach the
// listing. Every recheck failure transitions the proposal to "stale" (the
// target moved after the review), exactly once, with no mutation of the
// draft or product.
const executeListingProposal = async (tx, { proposal, userId, now }) => {
  const payload = proposal.canonicalPayload;
  const markStale = async () => {
    const claimed = await transitionPending(tx, proposal.id, userId, { status: "stale" });
    if (claimed.count === 1) await writeOutbox(tx, proposal.id, "stale", proposal.payloadHash);
    return resolveTerminal(await reloadProposal(tx, proposal.id));
  };

  if (proposal.actionKind === LISTING_PUBLISH_ACTION_KIND) {
    // Recheck: the draft must still be owned by the proposal subject under the
    // grant that created it, still be an unpublished "Draft" (a later save
    // supersedes it), and still sit at the version the proposal pinned.
    const draft = await tx.listingDraft.findFirst({
      where: { id: payload.draftId, sellerId: userId, grantId: proposal.grantId },
      select: { id: true, status: true, version: true },
    });
    if (!draft || draft.status !== "Draft" || draft.version !== proposal.expectedVersion) {
      return markStale();
    }

    // Exactly-once claim first: concurrent confirmations serialize here (see
    // the module comment), so only one transaction ever creates the product.
    const claimed = await transitionPending(tx, proposal.id, userId, {
      status: "executed",
      executedAt: now,
      executionReference: executionReferenceFor(proposal.id),
    });
    if (claimed.count !== 1) return resolveTerminal(await reloadProposal(tx, proposal.id));

    // Create the live product from the EXACT stored canonical payload — never
    // re-reading draft text or trusting the HTTP body — using the storefront
    // product-creation shape with the documented publish constants: no price
    // and no stock (placeholders 0/0), no images, the storefront's own
    // "Uncategorized" category default, live (not archived). The storefront
    // createProduct notification fan-out is deliberately NOT part of these
    // semantics: execution writes no notification and no broadcast.
    await tx.product.create({
      data: {
        id: generateId(),
        name: payload.title,
        description: payload.description,
        price: 0,
        quantity: 0,
        images: [],
        category: "Uncategorized",
        isArchived: false,
        sellerId: userId,
      },
    });
    await writeOutbox(tx, proposal.id, "executed", proposal.payloadHash);
    return resolveTerminal(await reloadProposal(tx, proposal.id));
  }

  // listing.update_content: the product must still be owned by the subject
  // and still sit at the previewed updatedAt-seconds version proxy (any
  // concurrent mutation — price, stock, content — changes updatedAt and
  // makes the proposal stale).
  const product = await tx.product.findFirst({
    where: { id: payload.productId, sellerId: userId },
    select: { id: true, updatedAt: true },
  });
  if (!product || listingProductVersionOf(product.updatedAt) !== proposal.expectedVersion) {
    return markStale();
  }

  // Optimistic compare-and-swap on the exact updatedAt the recheck saw (the
  // closest Product has to a version column, since there is no version
  // column): if a concurrent mutation commits between the read and this
  // write, the row no longer matches and nothing is touched. The applied
  // data is the stored allowlisted content verbatim — exact stored values,
  // nothing else.
  const applied = await tx.product.updateMany({
    where: { id: payload.productId, sellerId: userId, updatedAt: product.updatedAt },
    data: payload.content,
  });
  if (applied.count !== 1) return markStale();

  const claimed = await transitionPending(tx, proposal.id, userId, {
    status: "executed",
    executedAt: now,
    executionReference: executionReferenceFor(proposal.id),
  });
  if (claimed.count !== 1) return resolveTerminal(await reloadProposal(tx, proposal.id));
  await writeOutbox(tx, proposal.id, "executed", proposal.payloadHash);
  return resolveTerminal(await reloadProposal(tx, proposal.id));
};

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
        disclosures: DISCLOSURES[proposal.actionKind] ?? [],
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
    const displayNameOf = (preview) => {
      if (typeof preview?.productName === "string") return preview.productName.slice(0, 200);
      // Listing publish previews carry the draft title instead (#26).
      if (typeof preview?.title === "string") return preview.title.slice(0, 200);
      return null;
    };
    return res.json({
      proposals: rows.map((row) => ({
        id: row.id,
        actionKind: row.actionKind,
        status: effectiveStatus(row, now),
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        productName: displayNameOf(row.preview),
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
        select: { id: true, role: true, email: true, isVerified: true },
      });
      if (!account) return { kind: "not_found" };
      if (account.role !== proposal.role) {
        const claimed = await transitionPending(tx, proposal.id, userId, { status: "rejected" });
        if (claimed.count === 1) await writeOutbox(tx, proposal.id, "rejected", proposal.payloadHash);
        return resolveTerminal(await reloadProposal(tx, proposal.id));
      }

      // 4b. Listing proposals (#26) additionally require the acting account to
      //     be a VERIFIED seller right now (the same live-account requirement
      //     the propose-time gate enforced). Unlike staleness this is not a
      //     property of the proposal — verification can be granted later — so
      //     the proposal stays pending and the caller gets the fixed
      //     403 verification_required with no transition and no mutation.
      if (proposal.actionKind.startsWith("listing.")) {
        if (!account.isVerified) return { kind: "forbidden" };
        return executeListingProposal(tx, { proposal, userId, now });
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
      return {
        kind: "executed",
        executionReference: executionReferenceFor(proposal.id),
        cartVersion: proposal.expectedVersion + 1,
      };
    });

    if (outcome.kind === "not_found") {
      return res.status(404).json({ code: "not_found", message: "Resource not found" });
    }
    if (outcome.kind === "forbidden") {
      return res.status(403).json({ code: "verification_required", message: "Seller verification is required" });
    }
    if (outcome.kind === "executed") {
      const body = { status: "executed", executionReference: outcome.executionReference };
      if (outcome.cartVersion !== undefined) body.cartVersion = outcome.cartVersion;
      return res.json(body);
    }
    return res.status(409).json({
      code: "proposal_not_executable",
      reason: outcome.reason,
      message: "Proposal is no longer executable",
    });
  } catch (error) {
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
