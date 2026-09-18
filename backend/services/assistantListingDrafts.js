// Seller listing drafts for issue #20: deterministic, template-based copy
// composition plus owned, versioned, never-published draft storage.
//
// Guarantees (mirroring the ticket's acceptance criteria):
// - Copy is composed ONLY from caller-supplied facts and one seller-owned
//   product's public-safe fields (name, category, description, option
//   kinds/values). No stock counts, competitor data, or archived-state
//   details are read, and the templates invent no condition, warranty, or
//   policy claims — the description always ends with a fixed pointer to the
//   approved ShopSphere store policy, cited with versioned sources from
//   assistantPolicy.getApprovedPolicy.
// - Saving creates or versions ONLY an owned listing_drafts row. No Product
//   mutation, notification, storefront call, or broadcast exists in this
//   module, and grant isolation is enforced by predicates that carry BOTH
//   sellerId = principal.subject AND grantId = principal.grantId (foreign,
//   missing, and cross-grant ids are indistinguishable 404s). RLS is the
//   defense in depth behind these predicates.
// - Unverified sellers can draft: nothing in this module consults isVerified.
import crypto from "node:crypto";

import { getApprovedPolicy } from "./assistantPolicy.js";
import { createCursorCodec } from "./assistantCursor.js";

const TITLE_MAX = 140;
const DESCRIPTION_MAX = 4000;
const HIGHLIGHTS_MAX = 10;
const HIGHLIGHT_MAX = 200;
const PRODUCT_NAME_MAX = 140;
const KEY_FEATURES_MAX = 10;
const KEY_FEATURE_MAX = 200;
const AUDIENCE_NOTE_MAX = 300;
const CATEGORY_MAX = 100;
const OPTION_KIND_MAX = 50;
const OPTION_VALUE_MAX = 100;
const ID_MAX = 100;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// The template's only policy voice: a fixed pointer that defers condition,
// warranty, and policy claims to the approved store policy, backed by the
// versioned citations of the topics a listing would most plausibly touch.
const POLICY_TOPICS_CITED = Object.freeze(["warranty", "returns"]);
const POLICY_POINTER = "This draft restates only the supplied facts; it makes no condition, warranty, return, or payment claims. The approved ShopSphere store policy is the source of truth for binding terms.";

const { decode: decodeCursor, encode: encodeCursor } = createCursorCodec({ operation: "listings.listDrafts" });

const notFound = () => Object.assign(new Error("Resource not found"), { statusCode: 404, code: "not_found" });
const badInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });

const newDraftId = () => crypto.randomBytes(12).toString("hex");

const boundedText = (value, max) => String(value ?? "").slice(0, max);
const boundedHighlights = (highlights) =>
  (Array.isArray(highlights) ? highlights : [])
    .slice(0, HIGHLIGHTS_MAX)
    .map((highlight) => boundedText(highlight, HIGHLIGHT_MAX))
    .filter((highlight) => highlight.length > 0);

// Public-safe owned-product projection: nothing here feeds stock counts,
// competitor fields, or archived-state details into the copy.
const productSourceSelect = {
  id: true,
  name: true,
  category: true,
  description: true,
  options: { select: { kind: true, value: true } },
};

const loadOwnedProduct = async (client, principal, sourceProductId) => {
  if (!sourceProductId || typeof sourceProductId !== "string" || sourceProductId.length > ID_MAX) {
    throw notFound();
  }
  const row = await client.product.findFirst({
    where: { id: sourceProductId, sellerId: principal.subject },
    select: productSourceSelect,
  });
  if (!row) throw notFound();
  return row;
};

// Deterministic template composition. Every line restates a supplied fact or
// names the owned product; the only generated sentence is the fixed policy
// pointer.
const composeCopy = ({ product, facts }) => {
  const productName = boundedText(facts?.productName ?? product?.name ?? "Untitled listing", PRODUCT_NAME_MAX);
  const category = product?.category ? boundedText(product.category, CATEGORY_MAX) : null;
  const keyFeatures = (Array.isArray(facts?.keyFeatures) ? facts.keyFeatures : [])
    .slice(0, KEY_FEATURES_MAX)
    .map((feature) => boundedText(feature, KEY_FEATURE_MAX))
    .filter((feature) => feature.length > 0);
  const audienceNote = facts?.audienceNote ? boundedText(facts.audienceNote, AUDIENCE_NOTE_MAX) : null;

  const seenOptions = new Set();
  const options = (Array.isArray(product?.options) ? product.options : [])
    .map((option) => ({
      kind: boundedText(option?.kind, OPTION_KIND_MAX),
      value: boundedText(option?.value, OPTION_VALUE_MAX),
    }))
    .filter(({ kind, value }) => {
      if (!kind || !value) return false;
      const key = `${kind}\u0000${value}`;
      if (seenOptions.has(key)) return false;
      seenOptions.add(key);
      return true;
    })
    .slice(0, HIGHLIGHTS_MAX);

  const highlights = [
    ...keyFeatures,
    ...options.map(({ kind, value }) => `${kind}: ${value}`),
  ].slice(0, HIGHLIGHTS_MAX);

  const lines = [
    productName,
    category ? `${productName} is listed in the ${category} category on ShopSphere.` : null,
    "",
    ...(keyFeatures.length > 0 ? ["Key features:", ...keyFeatures.map((feature) => `- ${feature}`), ""] : []),
    ...(options.length > 0 ? ["Options:", ...options.map(({ kind, value }) => `- ${kind}: ${value}`), ""] : []),
    ...(audienceNote ? [audienceNote, ""] : []),
    POLICY_POINTER,
  ];

  return {
    title: productName,
    description: lines.filter((line) => line !== null).join("\n").slice(0, DESCRIPTION_MAX),
    highlights,
  };
};

export const draftListingCopy = async (
  { sourceProductId, facts } = {},
  { client, principal, now = new Date() },
) => {
  if (!sourceProductId && !facts) throw badInput("sourceProductId or facts is required");
  const product = sourceProductId ? await loadOwnedProduct(client, principal, sourceProductId) : null;
  const composed = composeCopy({ product, facts });
  const citations = (await Promise.all(
    POLICY_TOPICS_CITED.map(async (topic) => {
      const approved = await getApprovedPolicy(topic);
      return approved.sources;
    }),
  )).flat().slice(0, HIGHLIGHTS_MAX);
  return {
    ...composed,
    citations,
    generatedAt: now.toISOString(),
  };
};

const draftRowSelect = {
  id: true,
  sellerId: true,
  grantId: true,
  sourceProductId: true,
  title: true,
  description: true,
  highlights: true,
  status: true,
  version: true,
  supersedesId: true,
  createdAt: true,
  updatedAt: true,
};

export const saveListingDraft = async (
  { draftId, title, description, highlights, sourceProductId } = {},
  { client, principal, now = new Date() },
) => {
  if (draftId !== undefined && (!draftId || typeof draftId !== "string" || draftId.length > ID_MAX)) {
    throw notFound();
  }
  const content = {
    title: boundedText(title, TITLE_MAX),
    description: boundedText(description, DESCRIPTION_MAX),
    highlights: boundedHighlights(highlights),
  };
  if (!content.title || !content.description) throw badInput("title and description are required");

  // Provenance must stay owned: a foreign or missing source product is the
  // same generic 404 as everywhere else.
  let ownedSource = null;
  if (sourceProductId !== undefined) {
    ownedSource = await loadOwnedProduct(client, principal, sourceProductId);
  }

  const persisted = {
    sellerId: principal.subject,
    grantId: principal.grantId,
    sourceProductId: ownedSource?.id ?? null,
    title: content.title,
    description: content.description,
    highlights: content.highlights,
    status: "Draft",
  };

  if (!draftId) {
    const createdId = newDraftId();
    await client.listingDraft.create({
      data: { ...persisted, id: createdId, version: 1, supersedesId: null, createdAt: now, updatedAt: now },
    });
    return { draftId: createdId, version: 1, status: "Draft", savedAt: now.toISOString() };
  }

  const existing = await client.listingDraft.findFirst({
    where: { id: draftId, sellerId: principal.subject, grantId: principal.grantId },
    select: { id: true, version: true, sourceProductId: true },
  });
  if (!existing) throw notFound();

  const nextVersion = existing.version + 1;
  const createdId = newDraftId();
  await client.listingDraft.create({
    data: {
      ...persisted,
      id: createdId,
      version: nextVersion,
      supersedesId: existing.id,
      sourceProductId: ownedSource?.id ?? existing.sourceProductId ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });
  // Supersede-only mutation: status flips, content never changes (and the
  // runtime role has no UPDATE grant on the content columns anyway).
  await client.listingDraft.update({
    where: { id: existing.id },
    data: { status: "Superseded", updatedAt: now },
  });
  return { draftId: createdId, version: nextVersion, status: "Draft", savedAt: now.toISOString() };
};

export const listMyListingDrafts = async (
  { cursor, limit = DEFAULT_LIMIT, includeSuperseded = false } = {},
  { client, principal, cursorSecret },
) => {
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const query = { limit: boundedLimit, includeSuperseded: Boolean(includeSuperseded) };
  const position = decodeCursor(cursor, principal, query, cursorSecret);
  const rows = await client.listingDraft.findMany({
    where: {
      sellerId: principal.subject,
      grantId: principal.grantId,
      ...(query.includeSuperseded ? {} : { status: "Draft" }),
      ...(position ? {
        OR: [
          { createdAt: { lt: new Date(position.createdAt) } },
          { createdAt: new Date(position.createdAt), id: { lt: position.id } },
        ],
      } : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      version: true,
      sourceProductId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit + 1,
  });
  const page = rows.slice(0, boundedLimit);
  return {
    drafts: page.map((row) => ({
      draftId: row.id,
      title: boundedText(row.title, TITLE_MAX),
      status: row.status === "Superseded" ? "Superseded" : "Draft",
      version: row.version,
      sourceProductId: row.sourceProductId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > boundedLimit
      ? encodeCursor(page.at(-1), principal, query, cursorSecret)
      : null,
  };
};

export const getMyListingDraft = async ({ draftId } = {}, { client, principal }) => {
  if (!draftId || typeof draftId !== "string" || draftId.length > ID_MAX) throw notFound();
  const row = await client.listingDraft.findFirst({
    where: { id: draftId, sellerId: principal.subject, grantId: principal.grantId },
    select: draftRowSelect,
  });
  if (!row) throw notFound();
  return {
    draftId: row.id,
    title: boundedText(row.title, TITLE_MAX),
    description: boundedText(row.description, DESCRIPTION_MAX),
    highlights: boundedHighlights(row.highlights),
    status: row.status === "Superseded" ? "Superseded" : "Draft",
    version: row.version,
    supersedesId: row.supersedesId ?? null,
    sourceProductId: row.sourceProductId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};
