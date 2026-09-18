// Adversarial units for the #26 seller listing proposal service and the
// verified-seller gate. Style follows assistantProposals.test.js /
// assistantSellerOrders.test.js: fake prisma stand-ins, capture predicates and
// writes, and THROWS on any mutation outside the proposal/outbox pair so a
// regression that publishes, updates, archives, or notifies during proposal
// creation fails loudly here.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTING_CONTENT_CHANGE_ACTION_KIND,
  LISTING_CONTENT_CHANGE_DISCLOSURES,
  LISTING_PUBLISH_ACTION_KIND,
  LISTING_PUBLISH_DISCLOSURES,
  listingProductVersionOf,
  proposeListingContentChange,
  proposeListingContentChangeInputSchema,
  proposeListingPublish,
  proposeListingPublishInputSchema,
  publishedContentOf,
  publishedDescriptionOf,
} from "./assistantListingProposals.js";
import {
  VERIFICATION_REQUIRED_CODE,
  VERIFICATION_REQUIRED_STATUS,
  isVerifiedSellerPrincipal,
  requireVerifiedSeller,
} from "./assistantVerifiedSellerGate.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const GRANT = "grant-1";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";

const principal = { subject: SELLER, role: "seller", clientId: "shopsphere-mcp-client", grantId: GRANT };
const now = new Date("2026-09-19T10:00:00.000Z");

const draftRow = (overrides = {}) => ({
  id: "d4f1a2b3c4d5e6f7a8b9c0d1",
  sourceProductId: null,
  title: "MacBook Air M2 — renewed",
  description: "Renewed MacBook Air M2 copy.",
  highlights: ["18-hour battery", "M2 chip"],
  status: "Draft",
  version: 3,
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: "prod-1",
  name: "Headphones",
  description: "Old copy",
  images: ["https://shop.example/img/1.jpg"],
  sellerId: SELLER,
  updatedAt: new Date("2026-09-19T09:59:59.250Z"),
  ...overrides,
});

// Fake client: reads answered from fixtures; EVERY write other than
// proposal.create and proposalOutboxEvent.create throws. Proposal creation
// must therefore be provably mutation-free.
const createClient = ({ draft = draftRow(), product = productRow() } = {}) => {
  const state = { proposals: [], outbox: [], violations: [] };
  const forbidden = (table, method) => async () => {
    state.violations.push(`${table}.${method}`);
    throw new Error(`forbidden write during proposal creation: ${table}.${method}`);
  };
  const client = {
    listingDraft: {
      findFirst: async ({ where }) => {
        if (where.id !== draft.id || where.sellerId !== SELLER || where.grantId !== GRANT) return null;
        return draft;
      },
      findMany: forbidden("listingDraft", "findMany"),
      create: forbidden("listingDraft", "create"),
      update: forbidden("listingDraft", "update"),
      updateMany: forbidden("listingDraft", "updateMany"),
      delete: forbidden("listingDraft", "delete"),
    },
    product: {
      findFirst: async ({ where }) => {
        if (where.id !== product.id || where.sellerId !== SELLER) return null;
        return product;
      },
      findUnique: forbidden("product", "findUnique"),
      findMany: forbidden("product", "findMany"),
      create: forbidden("product", "create"),
      update: forbidden("product", "update"),
      updateMany: forbidden("product", "updateMany"),
      delete: forbidden("product", "delete"),
    },
    notification: {
      create: forbidden("notification", "create"),
      createMany: forbidden("notification", "createMany"),
    },
    user: {
      findMany: forbidden("user", "findMany"),
      update: forbidden("user", "update"),
    },
    cart: { findFirst: forbidden("cart", "findFirst"), update: forbidden("cart", "update") },
    cartItem: { create: forbidden("cartItem", "create"), update: forbidden("cartItem", "update") },
    proposal: {
      create: async ({ data }) => {
        state.proposals.push(data);
        return data;
      },
      count: forbidden("proposal", "count"),
      update: forbidden("proposal", "update"),
      updateMany: forbidden("proposal", "updateMany"),
    },
    proposalOutboxEvent: {
      create: async ({ data }) => {
        state.outbox.push(data);
        return data;
      },
    },
  };
  return { client, state };
};

// ---------------------------------------------------------------------------
// Verification gate
// ---------------------------------------------------------------------------

const resStub = () => {
  const record = { status: null, body: null };
  return {
    record,
    status(code) {
      record.status = code;
      return { json(body) { record.body = body; return record; } };
    },
  };
};

test("requireVerifiedSeller passes only when the token claim AND the live account are verified", async () => {
  const middleware = requireVerifiedSeller();
  let next = 0;
  const ok = { delegation: { verified: true }, assistantAccount: { isVerified: true } };
  await middleware(ok, resStub(), () => { next += 1; });
  assert.equal(next, 1);

  for (const req of [
    { delegation: { verified: false }, assistantAccount: { isVerified: true } },
    { delegation: { verified: true }, assistantAccount: { isVerified: false } },
    { delegation: { verified: false }, assistantAccount: { isVerified: false } },
    { delegation: {}, assistantAccount: { isVerified: true } },
    {},
  ]) {
    const res = resStub();
    let called = 0;
    await middleware(req, res, () => { called += 1; });
    assert.equal(called, 0);
    assert.equal(res.record.status, VERIFICATION_REQUIRED_STATUS);
    assert.equal(res.record.body.code, VERIFICATION_REQUIRED_CODE);
  }
  assert.equal(isVerifiedSellerPrincipal({ delegation: { verified: true }, assistantAccount: { isVerified: true } }), true);
  assert.equal(isVerifiedSellerPrincipal({ delegation: { verified: true }, assistantAccount: { isVerified: false } }), false);
});

test("requireVerifiedSeller durably audits its denial and fails closed when the audit write fails", async () => {
  const audits = [];
  const auditing = requireVerifiedSeller({ audit: async (event) => { audits.push(event); } });
  const req = { requestId: "req-1", delegation: { verified: false }, assistantAccount: { isVerified: true } };
  const res = resStub();
  await auditing(req, res, () => assert.fail("next must not run"));
  assert.equal(res.record.status, VERIFICATION_REQUIRED_STATUS);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].authorizationOutcome, "denied");
  assert.equal(audits[0].outcome, VERIFICATION_REQUIRED_CODE);

  const failing = requireVerifiedSeller({ audit: async () => { throw new Error("audit down"); } });
  const res2 = resStub();
  await failing({ requestId: "req-2", delegation: { verified: true }, assistantAccount: { isVerified: false } }, res2, () => assert.fail("next must not run"));
  assert.equal(res2.record.status, 503);
  assert.equal(res2.record.body.code, "audit_unavailable");
});

// ---------------------------------------------------------------------------
// Ownership predicates: foreign, missing, and cross-grant are the same 404
// ---------------------------------------------------------------------------

test("propose_listing_publish resolves the draft by sellerId AND grantId; foreign and missing are identical 404s", async () => {
  const { client } = createClient();

  const foreignError = await assert.rejects(proposeListingPublish(
    { draftId: draftRow().id },
    { client, principal: { ...principal, subject: RIVAL }, now },
  ), { statusCode: 404, code: "not_found" });
  const missingError = await assert.rejects(proposeListingPublish(
    { draftId: "ffffffffffffffffffffffff" },
    { client, principal, now },
  ), { statusCode: 404, code: "not_found" });
  // Identical denial objects: no existence or ownership leak.
  assert.deepEqual({ ...foreignError }, { ...missingError });

  // A superseded draft is refused as invalid input, not silently proposed.
  const supersededClient = createClient({ draft: draftRow({ status: "Superseded" }) });
  await assert.rejects(
    proposeListingPublish({ draftId: draftRow().id }, { client: supersededClient.client, principal, now }),
    { statusCode: 400 },
  );
});

test("propose_listing_content_change resolves the product by current ownership; foreign and missing are identical 404s", async () => {
  const { client } = createClient();

  const foreignError = await assert.rejects(proposeListingContentChange(
    { productId: productRow().id, content: { name: "New name" } },
    { client, principal: { ...principal, subject: RIVAL }, now },
  ), { statusCode: 404, code: "not_found" });
  const missingError = await assert.rejects(proposeListingContentChange(
    { productId: "ffffffffffffffffffffffff", content: { name: "New name" } },
    { client, principal, now },
  ), { statusCode: 404, code: "not_found" });
  assert.deepEqual({ ...foreignError }, { ...missingError });
});

// ---------------------------------------------------------------------------
// Strict allowlist schema: identity/price/stock/visibility/deletion rejected
// ---------------------------------------------------------------------------

test("the content-change schema is a closed allowlist", () => {
  const ok = proposeListingContentChangeInputSchema.safeParse({
    productId: "prod-1",
    content: { name: "New name", description: "New copy", images: ["https://shop.example/a.jpg"] },
  });
  assert.equal(ok.success, true);

  // Every forbidden field fails, at the content level and at the top level.
  for (const content of [
    { sellerId: RIVAL },
    { price: "100.00" },
    { stock: 5 },
    { quantity: 5 },
    { isArchived: true },
    { isArchived: false },
    { delete: true },
    { discount: "10" },
    { visible: false },
    {},
  ]) {
    assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content }).success, false, JSON.stringify(content));
  }
  for (const extra of [
    { productId: "prod-1", content: { name: "x" }, sellerId: RIVAL },
    { productId: "prod-1", content: { name: "x" }, price: "1" },
    { productId: "prod-1", content: { name: "x" }, stock: 1 },
    { productId: "prod-1", content: { name: "x" }, isArchived: true },
    { productId: "prod-1", content: { name: "x" }, delete: true },
    { productId: "prod-1", content: { name: "x" }, action: "delete" },
  ]) {
    assert.equal(proposeListingContentChangeInputSchema.safeParse(extra).success, false, JSON.stringify(extra));
  }
  // Bounds: name 140, description 4000, images 6 x 500.
  assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content: { name: "x".repeat(141) } }).success, false);
  assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content: { name: "x".repeat(140) } }).success, true);
  assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content: { description: "x".repeat(4001) } }).success, false);
  assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content: { images: Array.from({ length: 7 }, () => "https://x/a.jpg") } }).success, false);
  assert.equal(proposeListingContentChangeInputSchema.safeParse({ productId: "prod-1", content: { images: ["x".repeat(501)] } }).success, false);
  // Publish input: exactly one 24-char draftId, nothing else.
  assert.equal(proposeListingPublishInputSchema.safeParse({ draftId: "d4f1a2b3c4d5e6f7a8b9c0d1" }).success, true);
  assert.equal(proposeListingPublishInputSchema.safeParse({ draftId: "short" }).success, false);
  assert.equal(proposeListingPublishInputSchema.safeParse({ draftId: "d4f1a2b3c4d5e6f7a8b9c0d1", confirm: true }).success, false);
  assert.equal(proposeListingPublishInputSchema.safeParse({ draftId: "d4f1a2b3c4d5e6f7a8b9c0d1", executeNow: true }).success, false);
});

// ---------------------------------------------------------------------------
// Proposal creation mutates nothing beyond the proposal + outbox rows
// ---------------------------------------------------------------------------

test("propose_listing_publish persists only the proposal and its created outbox event", async () => {
  const { client, state } = createClient();
  const output = await proposeListingPublish({ draftId: draftRow().id }, { client, principal, now });

  assert.deepEqual(state.violations, []);
  assert.equal(state.proposals.length, 1);
  const row = state.proposals[0];
  assert.equal(row.actionKind, LISTING_PUBLISH_ACTION_KIND);
  assert.equal(row.targetType, "listing_draft");
  assert.equal(row.targetId, draftRow().id);
  assert.equal(row.subjectId, SELLER);
  assert.equal(row.grantId, GRANT);
  assert.equal(row.role, "seller");
  assert.equal(row.status, "pending");
  // Version proxy: the draft's own monotonic version column.
  assert.equal(row.expectedVersion, 3);
  assert.equal(row.payloadHash.length, 64);
  // Stored canonical payload is the exact server-resolved content snapshot.
  assert.deepEqual(row.canonicalPayload, {
    draftId: draftRow().id,
    title: "MacBook Air M2 — renewed",
    description: "Renewed MacBook Air M2 copy.\n\nHighlights:\n- 18-hour battery\n- M2 chip",
    highlights: ["18-hour battery", "M2 chip"],
    sourceProductId: null,
  });
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].eventType, "created");
  assert.equal(state.outbox[0].payloadHash, row.payloadHash);
  assert.equal(output.status, "pending");
  assert.equal(output.proposalId, row.id);
  // Preview exposes exactly the reviewed content and the fixed disclosures.
  assert.equal(output.preview.actionKind, LISTING_PUBLISH_ACTION_KIND);
  assert.equal(output.preview.description, row.canonicalPayload.description);
  assert.deepEqual(output.preview.disclosedConsequences, [...LISTING_PUBLISH_DISCLOSURES]);
  // Ten-minute TTL, unchanged from the platform.
  assert.equal(new Date(output.expiresAt).getTime() - now.getTime(), 10 * 60 * 1000);
});

test("propose_listing_content_change persists only the proposal and its created outbox event", async () => {
  const { client, state } = createClient();
  const output = await proposeListingContentChange(
    { productId: "prod-1", content: { name: "Headphones (2026)", description: "New copy" } },
    { client, principal, now },
  );

  assert.deepEqual(state.violations, []);
  const row = state.proposals[0];
  assert.equal(row.actionKind, LISTING_CONTENT_CHANGE_ACTION_KIND);
  assert.equal(row.targetType, "product");
  assert.equal(row.targetId, "prod-1");
  // Version proxy: updatedAt seconds, not milliseconds (ms would overflow int4).
  assert.equal(row.expectedVersion, listingProductVersionOf(productRow().updatedAt));
  assert.equal(row.expectedVersion, Math.floor(new Date("2026-09-19T09:59:59.250Z").getTime() / 1000));
  assert.deepEqual(row.canonicalPayload, {
    productId: "prod-1",
    content: { name: "Headphones (2026)", description: "New copy" },
  });
  // Exact before/after for the changed fields only; no money anywhere.
  assert.deepEqual(output.preview.before, { name: "Headphones", description: "Old copy" });
  assert.deepEqual(output.preview.after, { name: "Headphones (2026)", description: "New copy" });
  // No money or visibility fields exist on either preview side.
  for (const side of [output.preview.before, output.preview.after]) {
    for (const forbidden of ["price", "stock", "quantity", "discount", "isArchived", "sellerId", "delete"]) {
      assert.equal(Object.hasOwn(side, forbidden), false);
    }
  }
  assert.deepEqual(output.preview.disclosedConsequences, [...LISTING_CONTENT_CHANGE_DISCLOSURES]);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].eventType, "created");
});

test("a content proposal that would change nothing is refused and writes nothing", async () => {
  const { client, state } = createClient();
  await assert.rejects(proposeListingContentChange(
    { productId: "prod-1", content: { name: "Headphones" } },
    { client, principal, now },
  ), { statusCode: 400 });
  assert.deepEqual(state.proposals, []);
  assert.deepEqual(state.outbox, []);
});

// ---------------------------------------------------------------------------
// Version proxies and published-content mapping bounds
// ---------------------------------------------------------------------------

test("listingProductVersionOf encodes whole seconds and stays inside int4", () => {
  const date = new Date("2026-09-19T09:59:59.750Z");
  assert.equal(listingProductVersionOf(date), Math.floor(date.getTime() / 1000));
  assert.equal(Number.isSafeInteger(listingProductVersionOf(date)), true);
  assert.ok(listingProductVersionOf(date) < 2_147_483_647);
  assert.equal(listingProductVersionOf("2026-09-19T09:59:59.750Z"), listingProductVersionOf(date));
});

test("publishedContentOf bounds the mapping and appends highlights deterministically", () => {
  assert.equal(publishedDescriptionOf("Base copy.", ["one", "two"]), "Base copy.\n\nHighlights:\n- one\n- two");
  assert.equal(publishedDescriptionOf("Base copy.", []), "Base copy.");
  assert.equal(publishedDescriptionOf("x".repeat(5000), []).length, 4000);
  const draft = draftRow({
    title: "t".repeat(500),
    description: "d".repeat(5000),
    highlights: Array.from({ length: 15 }, (_, index) => `h${index}`),
  });
  const content = publishedContentOf(draft);
  assert.equal(content.name.length, 140);
  assert.ok(content.description.length <= 4000);
  assert.equal(content.highlights.length, 10);
  assert.deepEqual(content.images, []);
  assert.equal(content.category, "Uncategorized");
  // Deterministic: the preview and the executor compute byte-identical content.
  assert.deepEqual(publishedContentOf(draft), content);
});
