// Seller listing proposals for issue #26: propose to publish an owned listing
// draft, or propose an allowlisted content change to an owned live listing.
//
// Both operations persist ONLY a proposal row (plus the platform's one
// "created" outbox event in the same transaction): they never create or update
// a Product, never flip a draft's status, never archive/unarchive, never
// broadcast, and never write a notification. The live mutation happens
// exclusively through the first-party browser execution endpoint
// (routes/proposalExecutionRoute.js).
//
// Allowlist shape: the content-change input can only ever carry name,
// description, and images (enforced by the strict route/registry schemas —
// seller identity, price, stock, quantity, discount, archived/visibility and
// deletion fields fail schema validation before this service runs, and this
// service reads only allowlisted columns back out of the product).
//
// Ownership predicates follow the #20 draft platform: publishing resolves the
// draft by sellerId AND grantId, and content changes resolve the product by
// its current sellerId (the seller catalog predicate from
// assistantSellerCatalog.js). Foreign, missing, and cross-grant ids are the
// identical generic 404. Both operations run inside withAssistantActor as
// shopsphere_assistant_private_runtime; RLS (migration
// 20260919220000_assistant_listing_proposals) keys the same operations, so the
// predicates here are defense in depth, not the only gate.
//
// Verification gating: these services never consult isVerified themselves —
// the routes attach requireVerifiedSeller() (assistantVerifiedSellerGate.js)
// after authorization, so only a verified seller can reach this code.
import crypto from "node:crypto";

import { z } from "zod";

import { canonicalPayloadHash, PROPOSAL_TTL_MS } from "./assistantProposals.js";

// Strict input schemas (#26 allowlist). Exported so the routes and the tests
// exercise the identical objects: the closed field set is the allowlist
// enforcement — seller identity, price, stock, quantity, discount,
// archived/visibility, and deletion fields are not in the schema and therefore
// fail strict parsing before any service code runs. `content` must carry at
// least one allowlisted field (a no-op proposal is refused).
export const listingDraftIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "draftId must be a 24-character id");

export const proposeListingPublishInputSchema = z.object({ draftId: listingDraftIdSchema }).strict();

export const listingContentSchema = z.object({
  name: z.string().min(1).max(140).optional(),
  description: z.string().min(1).max(4000).optional(),
  images: z.array(z.string().min(1).max(500)).max(6).optional(),
}).strict();

export const proposeListingContentChangeInputSchema = z.object({
  productId: z.string().min(1).max(100),
  content: listingContentSchema,
}).strict().superRefine(({ content }, ctx) => {
  if (content.name === undefined && content.description === undefined && content.images === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "content requires at least one allowlisted field" });
  }
});

const TITLE_MAX = 140;
const DESCRIPTION_MAX = 4000;
const HIGHLIGHTS_MAX = 10;
const HIGHLIGHT_MAX = 200;
const PRODUCT_NAME_MAX = 140;
const IMAGES_MAX = 6;
const IMAGE_MAX = 500;
const ID_MAX = 100;

export const LISTING_PUBLISH_ACTION_KIND = "listing.publish_draft";
export const LISTING_CONTENT_CHANGE_ACTION_KIND = "listing.update_content";

// Fixed disclosures shown to the reviewer. The exact same strings are served
// by the first-party review endpoint, so the review screen and the MCP
// preview can never drift apart.
export const LISTING_PUBLISH_DISCLOSURES = Object.freeze([
  "Publishes a new live product with exactly the reviewed content",
  "No price or stock is set by this action — configure them in ShopSphere afterward",
  "No notifications are sent",
]);
export const LISTING_CONTENT_CHANGE_DISCLOSURES = Object.freeze([
  "Applies exactly the reviewed content changes to the live listing",
  "No price, stock, or visibility is changed",
  "No notifications are sent",
]);

// ---------------------------------------------------------------------------
// Version proxies
// ---------------------------------------------------------------------------
// ListingDraft carries a real monotonic `version` column (every save supersedes
// the old row and bumps it), so expectedVersion for a publish proposal is
// simply draft.version: any later save makes the proposal stale.
//
// Product has NO version column, so listing content changes use an
// updatedAt-based proxy: the epoch time in whole SECONDS of Product.updatedAt
// (Math.floor(ms / 1000)). Seconds — not milliseconds — because the
// proposals.expectedVersion column is integer (int4): millisecond epochs
// (~1.7e12) overflow it, second epochs (~1.78e9) fit until 2038. Every
// mutation of the product row (price, stock, options, content, anything)
// touches updatedAt via Prisma's @updatedAt, so the proxy goes stale on any
// concurrent change, which is the conservative behavior the ticket requires.
// The same helper is used at propose time and at execution time, so the two
// sides can never disagree about the encoding.
export const listingProductVersionOf = (updatedAt) =>
  Math.floor(new Date(updatedAt).getTime() / 1000);

// ---------------------------------------------------------------------------
// Publish content mapping (the exact, deterministic draft -> product shape)
// ---------------------------------------------------------------------------
// The live product created by an executed publish proposal is fully determined
// by the version-pinned draft content plus these fixed, documented constants:
//   - name        <- draft.title (bounded to the draft's own 140-char bound)
//   - description <- draft.description, and when the draft carries highlights,
//                    the highlights are appended as a fixed "- " bullet block
//                    so NO reviewed content is silently dropped (Product has
//                    no highlights column). The propose-time preview and the
//                    execution both call publishedDescriptionOf, so the
//                    description the reviewer saw is byte-for-byte the
//                    description that gets created.
//   - images      <- [] (the draft carries no images; the disclosure says
//                    price/stock are configured afterward, and imagery is
//                    part of that same follow-up configuration)
//   - category    <- "Uncategorized" (the storefront's own display default in
//                    productController.formatProductResponse; Product.category
//                    is a NOT NULL column)
//   - price/quantity <- 0 / 0 placeholders ("no price or stock is set"),
//                    deliberately allowed here because the storefront
//                    createProduct schema's positive-price rule is a UI-entry
//                    validation, not a data constraint; with quantity 0 the
//                    listing shows "Sold out" until the seller configures it.
//   - isArchived  <- false (a live, visible listing).
// The storefront createProduct notification fan-out is deliberately NOT part
// of these semantics: execution sends no notifications and no broadcasts.
const uncategorizedCategory = () => "Uncategorized";

const boundedHighlights = (highlights) =>
  (Array.isArray(highlights) ? highlights : [])
    .slice(0, HIGHLIGHTS_MAX)
    .map((highlight) => String(highlight ?? "").slice(0, HIGHLIGHT_MAX))
    .filter((highlight) => highlight.length > 0);

export const publishedDescriptionOf = (description, highlights) => {
  const base = String(description ?? "").slice(0, DESCRIPTION_MAX);
  if (highlights.length === 0) return base;
  const block = ["Highlights:", ...highlights.map((highlight) => `- ${highlight}`)].join("\n");
  return `${base}\n\n${block}`.slice(0, DESCRIPTION_MAX);
};

// The exact server snapshot of the product a publish execution would create.
// Used identically by the propose preview and the executor.
export const publishedContentOf = (draft) => {
  const highlights = boundedHighlights(draft.highlights);
  return {
    name: String(draft.title ?? "").slice(0, PRODUCT_NAME_MAX),
    description: publishedDescriptionOf(draft.description, highlights),
    highlights,
    images: [],
    category: uncategorizedCategory(),
  };
};

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

const writeProposal = async (client, { proposalId, principal, actionKind, targetType, targetId, canonicalPayload, preview, expectedVersion, now }) => {
  const payloadHash = canonicalPayloadHash(canonicalPayload);
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);
  await client.proposal.create({
    data: {
      id: proposalId,
      subjectId: principal.subject,
      role: principal.role,
      clientId: principal.clientId,
      grantId: principal.grantId,
      actionKind,
      targetType,
      targetId,
      canonicalPayload,
      preview,
      expectedVersion,
      payloadHash,
      status: "pending",
      expiresAt,
    },
  });
  // Same-transaction outcome record, exactly like proposeCartChange. Append-only.
  await client.proposalOutboxEvent.create({
    data: { id: crypto.randomUUID(), proposalId, eventType: "created", payloadHash },
  });
  return { payloadHash, expiresAt };
};

// ---------------------------------------------------------------------------
// propose_listing_publish
// ---------------------------------------------------------------------------
// Input is strictly { draftId } (already schema-bounded to 24 chars). The
// draft must be owned by sellerId AND grantId; a superseded draft is refused
// with the generic invalid-input error because publishing it is knowingly
// doomed (its version lineage moved on) — only status "Draft" rows propose.
export const proposeListingPublish = async ({ draftId } = {}, { client, principal, now = new Date() }) => {
  if (!draftId || typeof draftId !== "string" || draftId.length > ID_MAX) throw notFound();

  const draft = await client.listingDraft.findFirst({
    where: { id: draftId, sellerId: principal.subject, grantId: principal.grantId },
    select: {
      id: true,
      sourceProductId: true,
      title: true,
      description: true,
      highlights: true,
      status: true,
      version: true,
    },
  });
  if (!draft) throw notFound();
  if (draft.status !== "Draft") throw badInput("draft is superseded");

  const content = publishedContentOf(draft);
  const canonicalPayload = {
    draftId: draft.id,
    title: content.name,
    description: content.description,
    highlights: content.highlights,
    sourceProductId: draft.sourceProductId ?? null,
  };
  const preview = {
    actionKind: LISTING_PUBLISH_ACTION_KIND,
    draftId: draft.id,
    title: content.name,
    description: content.description,
    highlights: content.highlights,
    sourceProductId: canonicalPayload.sourceProductId,
    disclosedConsequences: LISTING_PUBLISH_DISCLOSURES,
  };

  const proposalId = crypto.randomBytes(12).toString("hex");
  const { expiresAt } = await writeProposal(client, {
    proposalId,
    principal,
    actionKind: LISTING_PUBLISH_ACTION_KIND,
    targetType: "listing_draft",
    targetId: draft.id,
    canonicalPayload,
    preview,
    // The draft's own monotonic version column is the optimistic-concurrency
    // token: a later save supersedes this row and bumps the version, which
    // makes the proposal stale at execution.
    expectedVersion: draft.version,
    now,
  });

  return { proposalId, status: "pending", expiresAt: expiresAt.toISOString(), preview };
};

// ---------------------------------------------------------------------------
// propose_listing_content_change
// ---------------------------------------------------------------------------
// Resolves the product by its CURRENT ownership (seller catalog predicate:
// sellerId = subject). The preview carries exact before/after objects that
// contain ONLY the allowlisted fields that would actually change, computed by
// strict value comparison against the live row — no money is involved. A
// proposal whose content would change nothing is refused as invalid input.
export const proposeListingContentChange = async ({ productId, content } = {}, { client, principal, now = new Date() }) => {
  if (!productId || typeof productId !== "string" || productId.length > ID_MAX) throw notFound();

  const product = await client.product.findFirst({
    where: { id: productId, sellerId: principal.subject },
    select: {
      id: true,
      name: true,
      description: true,
      images: true,
      sellerId: true,
      updatedAt: true,
    },
  });
  if (!product) throw notFound();

  const currentDescription = product.description ?? "";
  const currentImages = Array.isArray(product.images) ? product.images : [];
  const before = {};
  const after = {};
  if (content?.name !== undefined && content.name !== product.name) {
    before.name = String(product.name).slice(0, PRODUCT_NAME_MAX);
    after.name = content.name;
  }
  if (content?.description !== undefined && content.description !== currentDescription) {
    before.description = currentDescription;
    after.description = content.description;
  }
  if (content?.images !== undefined && JSON.stringify(content.images) !== JSON.stringify(currentImages)) {
    // The "after" side is the exact proposed array (schema-bounded to 6 x 500).
    // The "before" side is the live row's current array, display-bounded like
    // every other assistant projection (the public catalog bounds images to
    // 20 x 500) so a pathological stored row can never break the output
    // contract; real listings sit far below these bounds.
    before.images = currentImages
      .slice(0, 50)
      .map((image) => String(image).slice(0, IMAGE_MAX));
    after.images = content.images;
  }
  if (Object.keys(before).length === 0) throw badInput("no content changes");

  const canonicalPayload = { productId: product.id, content };
  const preview = {
    actionKind: LISTING_CONTENT_CHANGE_ACTION_KIND,
    productId: product.id,
    productName: String(product.name).slice(0, PRODUCT_NAME_MAX),
    before,
    after,
    disclosedConsequences: LISTING_CONTENT_CHANGE_DISCLOSURES,
  };

  const proposalId = crypto.randomBytes(12).toString("hex");
  const { expiresAt } = await writeProposal(client, {
    proposalId,
    principal,
    actionKind: LISTING_CONTENT_CHANGE_ACTION_KIND,
    targetType: "product",
    targetId: product.id,
    canonicalPayload,
    preview,
    // Product has no version column: the updatedAt-seconds proxy (documented
    // above) pins the previewed row. Any later mutation of the product —
    // including a completely unrelated price or stock edit — changes
    // updatedAt and makes this proposal stale at execution.
    expectedVersion: listingProductVersionOf(product.updatedAt),
    now,
  });

  return { proposalId, status: "pending", expiresAt: expiresAt.toISOString(), preview };
};
