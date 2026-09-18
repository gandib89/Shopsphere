import assert from "node:assert/strict";
import test from "node:test";

import {
  draftListingCopy,
  getMyListingDraft,
  listMyListingDrafts,
  saveListingDraft,
} from "./assistantListingDrafts.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const GRANT = "grant-1";
const RIVAL_GRANT = "grant-2";
const SECRET = "drafts-cursor-secret-that-is-long-enough-32!";
const principal = (subject = SELLER, grantId = GRANT) => ({ subject, role: "seller", clientId: "client-1", grantId });
const now = new Date("2026-09-19T04:00:00.000Z");

const productRow = (overrides = {}) => ({
  id: "prod-1",
  name: "RLS Lamp",
  category: "Home",
  description: "A lamp.",
  options: [
    { kind: "color", value: "Red" },
    { kind: "color", value: "Blue" },
  ],
  ...overrides,
});

const draftRow = (overrides = {}) => ({
  id: "draft-1",
  sellerId: SELLER,
  grantId: GRANT,
  sourceProductId: "prod-1",
  title: "RLS Lamp",
  description: "A draft description",
  highlights: ["warm light", "color: Red"],
  status: "Draft",
  version: 1,
  supersedesId: null,
  createdAt: new Date("2026-09-18T04:00:00.000Z"),
  updatedAt: new Date("2026-09-18T04:00:00.000Z"),
  ...overrides,
});

// Fake client that records every model.method call so the side-effect-freedom
// assertions can prove only listingDraft.create/update ever run. Un-provided
// find methods resolve to empty results; anything else that the service
// should never call records and then fails loudly.
const recordingClient = (handlers = {}) => {
  const calls = [];
  const model = (name, routes) => new Proxy(routes ?? {}, {
    get(target, method) {
      return async (args) => {
        calls.push([name, String(method), args]);
        if (method in target) return target[method](args);
        if (method === "findMany" || method === "groupBy") return [];
        if (method === "count" || method === "aggregate") return 0;
        return null;
      };
    },
  });
  const client = {
    product: model("product", { findFirst: async () => null }),
    listingDraft: model("listingDraft", {}),
    notification: model("notification"),
    order: model("order"),
    user: model("user"),
    ...(handlers.client ?? {}),
  };
  if (handlers.product) client.product = model("product", handlers.product);
  if (handlers.listingDraft) client.listingDraft = model("listingDraft", handlers.listingDraft);
  return { client, calls };
};

test("draft copy composes deterministically from supplied facts only", async () => {
  const { client, calls } = recordingClient();
  const output = await draftListingCopy({
    facts: {
      productName: "Handwoven Thangka",
      keyFeatures: ["Hand-painted canvas", "24k gold accents"],
      audienceNote: "Made by our Kathmandu workshop.",
    },
  }, { client, principal: principal(), now });
  assert.equal(Object.hasOwn(output, "title"), true);
  assert.equal(output.title, "Handwoven Thangka");
  assert.ok(output.description.includes("Hand-painted canvas"));
  assert.ok(output.description.includes("Made by our Kathmandu workshop."));
  assert.ok(output.description.includes("approved ShopSphere store policy"));
  assert.deepEqual(output.highlights, ["Hand-painted canvas", "24k gold accents"]);
  assert.equal(output.generatedAt, now.toISOString());
  // No product read happened: facts alone are enough.
  assert.deepEqual(calls.filter(([model]) => model === "product"), []);
  // Citations are the approved policy sources with pinned versions.
  assert.ok(output.citations.length >= 1);
  for (const citation of output.citations) {
    assert.match(citation.sourceId, /^faqs\.json#\d+$/);
    assert.equal(citation.sourceVersion, "1.0.0");
  }
});

test("draft copy invents no condition, warranty, or policy claims", async () => {
  const { client } = recordingClient();
  const output = await draftListingCopy({
    facts: { productName: "Used Phone", keyFeatures: [" cracked screen "] },
  }, { client, principal: principal(), now });
  const serialized = JSON.stringify(output);
  for (const invented of ["mint condition", "brand new", "certified", "lifetime", "1-year", "money-back", "free return"]) {
    assert.ok(!serialized.toLowerCase().includes(invented), invented);
  }
  // The only warranty/policy mention is the fixed pointer sentence deferring
  // to the approved store policy.
  const pointerSentences = output.description.split("\n").filter((line) => /warranty|policy/i.test(line));
  assert.deepEqual(pointerSentences, [
    "This draft restates only the supplied facts; it makes no condition, warranty, return, or payment claims. The approved ShopSphere store policy is the source of truth for binding terms.",
  ]);
});

test("draft copy sources from an owned product through the seller predicate", async () => {
  let where;
  let select;
  const { client, calls } = recordingClient({
    product: { findFirst: async (args) => { where = args.where; select = args.select; return productRow(); } },
  });
  const output = await draftListingCopy({ sourceProductId: "prod-1" }, { client, principal: principal(), now });
  assert.deepEqual(where, { id: "prod-1", sellerId: SELLER });
  // Public-safe fields only: no stock counts, no archived state details.
  assert.deepEqual(Object.keys(select).sort(), ["category", "description", "id", "name", "options"]);
  assert.deepEqual(Object.keys(select.options.select), ["kind", "value"]);
  assert.ok(output.title.includes("RLS Lamp"));
  assert.ok(output.description.includes("color: Red"));
  assert.ok(!JSON.stringify(output).match(/quantity|stock|isArchived/i));
  assert.deepEqual(calls.filter(([model, method]) => model === "product" && method !== "findFirst"), []);
});

test("foreign or missing source products are a generic not-found", async () => {
  // The only expressible lookup carries the seller predicate, so a rival
  // owner's row resolves to null — the same 404 as a missing id.
  const { client } = recordingClient({
    product: { findFirst: async () => null },
  });
  await assert.rejects(
    draftListingCopy({ sourceProductId: "rival-product" }, { client, principal: principal(), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    draftListingCopy({ sourceProductId: "rival-product" }, { client, principal: principal(RIVAL), now }),
    { statusCode: 404 },
  );
});

test("copy bounds are enforced before any consumer sees the output", async () => {
  const { client } = recordingClient({
    product: { findFirst: async () => productRow({ name: "x".repeat(500) }) },
  });
  const output = await draftListingCopy({
    sourceProductId: "prod-1",
    facts: { keyFeatures: Array.from({ length: 20 }, (_, i) => `f${i}`.padEnd(250, "y")) },
  }, { client, principal: principal(), now });
  assert.ok(output.title.length <= 140);
  assert.ok(output.description.length <= 4000);
  assert.ok(output.highlights.length <= 10);
  for (const highlight of output.highlights) assert.ok(highlight.length <= 200);
});

test("saving without a draftId creates one owned version-1 draft row", async () => {
  let createData;
  const { client, calls } = recordingClient({
    product: { findFirst: async () => productRow() },
    listingDraft: { create: async (args) => { createData = args.data; return draftRow(); } },
  });
  const output = await saveListingDraft({
    title: "T",
    description: "D",
    highlights: ["h"],
    sourceProductId: "prod-1",
  }, { client, principal: principal(), now });
  assert.equal(output.version, 1);
  assert.equal(output.status, "Draft");
  assert.equal(output.savedAt, now.toISOString());
  assert.equal(createData.sellerId, SELLER);
  assert.equal(createData.grantId, GRANT);
  assert.equal(createData.version, 1);
  assert.equal(createData.status, "Draft");
  assert.equal(createData.supersedesId, null);
  assert.ok(/^[0-9a-f]{24}$/.test(createData.id));
  // Provenance is owned-product only; the only mutations are draft rows.
  assert.deepEqual(calls.filter(([model]) => model === "product").map(([, method]) => method), ["findFirst"]);
  assert.deepEqual(calls.filter(([model]) => model === "listingDraft").map(([, method]) => method), ["create"]);
  assert.deepEqual(calls.filter(([model]) => model === "notification" || model === "order" || model === "user"), []);
});

test("saving with a draftId versions the draft without mutating the old content", async () => {
  let createData;
  let updateArgs;
  let findWhere;
  const { client, calls } = recordingClient({
    listingDraft: {
      findFirst: async (args) => { findWhere = args.where; return draftRow({ id: "draft-1", version: 3 }); },
      create: async (args) => { createData = args.data; return draftRow(); },
      update: async (args) => { updateArgs = args; return draftRow({ status: "Superseded" }); },
    },
  });
  const output = await saveListingDraft({
    draftId: "draft-1",
    title: "T2",
    description: "D2",
  }, { client, principal: principal(), now });
  assert.equal(output.draftId !== "draft-1", true);
  assert.equal(output.version, 4);
  assert.equal(output.status, "Draft");
  // Load predicate isolates subject AND grant.
  assert.deepEqual(findWhere, { id: "draft-1", sellerId: SELLER, grantId: GRANT });
  // New row is a fresh version superseding the old one.
  assert.equal(createData.version, 4);
  assert.equal(createData.supersedesId, "draft-1");
  assert.equal(createData.status, "Draft");
  // The old row's content is never rewritten — only the supersede status.
  assert.deepEqual(Object.keys(updateArgs.data).sort(), ["status", "updatedAt"]);
  assert.equal(updateArgs.data.status, "Superseded");
  assert.deepEqual(calls.filter(([model]) => model === "product").map(([, method]) => method), []);
});

test("cross-grant and foreign drafts are an identical not-found", async () => {
  const { client } = recordingClient({
    listingDraft: {
      findFirst: async (args) => {
        const match = args.where.sellerId === SELLER && args.where.grantId === GRANT;
        return match ? draftRow() : null;
      },
    },
  });
  await assert.rejects(
    saveListingDraft({ draftId: "draft-1", title: "T", description: "D" }, { client, principal: principal(SELLER, RIVAL_GRANT), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    saveListingDraft({ draftId: "draft-1", title: "T", description: "D" }, { client, principal: principal(RIVAL), now }),
    { statusCode: 404 },
  );
  await assert.rejects(
    getMyListingDraft({ draftId: "draft-1" }, { client, principal: principal(SELLER, RIVAL_GRANT) }),
    { statusCode: 404 },
  );
  await assert.rejects(
    getMyListingDraft({ draftId: "draft-1" }, { client, principal: principal(RIVAL) }),
    { statusCode: 404 },
  );
});

test("saving never mutates a Product, notification, or any non-draft model", async () => {
  const { client, calls } = recordingClient({
    product: { findFirst: async () => productRow() },
    listingDraft: {
      findFirst: async () => draftRow({ id: "draft-1", version: 1 }),
      create: async () => draftRow(),
      update: async () => draftRow({ status: "Superseded" }),
    },
  });
  await saveListingDraft({ title: "T", description: "D" }, { client, principal: principal(), now });
  await saveListingDraft({ draftId: "draft-1", title: "T", description: "D" }, { client, principal: principal(), now });
  const mutatedModels = new Set(
    calls
      .filter(([, method]) => ["create", "update", "updateMany", "upsert", "delete", "deleteMany", "createMany"].includes(method))
      .map(([model]) => model),
  );
  assert.deepEqual([...mutatedModels], ["listingDraft"]);
  const methods = calls.filter(([model]) => model === "listingDraft").map(([, method]) => method);
  assert.deepEqual(methods, ["create", "findFirst", "create", "update"]);
});

test("unverified sellers can draft: no isVerified predicate or account lookup exists", async () => {
  const { client, calls } = recordingClient({
    listingDraft: { create: async () => draftRow() },
    product: { findFirst: async () => productRow() },
  });
  await draftListingCopy({ sourceProductId: "prod-1" }, { client, principal: principal(), now });
  await saveListingDraft({ title: "T", description: "D" }, { client, principal: principal(), now });
  await listMyListingDrafts({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.deepEqual(calls.filter(([model]) => model === "user"), []);
  assert.ok(!JSON.stringify(calls).includes("isVerified"));
});

test("draft list predicates isolate subject and grant and default to live drafts", async () => {
  let where;
  const { client } = recordingClient({
    listingDraft: { findMany: async (args) => { where = args.where; return [draftRow()]; } },
  });
  const output = await listMyListingDrafts({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(where.sellerId, SELLER);
  assert.equal(where.grantId, GRANT);
  assert.equal(where.status, "Draft");
  assert.equal(output.drafts[0].draftId, "draft-1");
  assert.ok(!("description" in output.drafts[0]));
  await listMyListingDrafts({ includeSuperseded: true }, { client, principal: principal(), cursorSecret: SECRET });
  assert.ok(!("status" in where));
});

test("draft list pages are bounded and cursor-paginated", async () => {
  const rows = [
    draftRow({ id: "draft-2", createdAt: new Date("2026-09-19T00:00:00.000Z") }),
    draftRow({ id: "draft-1" }),
  ];
  let take;
  const { client } = recordingClient({
    listingDraft: { findMany: async (args) => { take = args.take; return rows; } },
  });
  const first = await listMyListingDrafts({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(take, 2);
  assert.equal(first.drafts.length, 1);
  assert.ok(first.nextCursor);
  assert.equal(first.nextCursor.length <= 2048, true);
  await listMyListingDrafts({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(take, 21, "default limit is 20");
  const bounded = await listMyListingDrafts({ limit: 500 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(bounded.drafts.length, 2);
  const complete = await listMyListingDrafts({ limit: 2 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(complete.nextCursor, null);
});

test("draft cursors are bound to the principal and grant", async () => {
  const rows = [
    draftRow({ id: "draft-2", createdAt: new Date("2026-09-19T00:00:00.000Z") }),
    draftRow({ id: "draft-1" }),
  ];
  const { client } = recordingClient({
    listingDraft: { findMany: async () => rows },
  });
  const first = await listMyListingDrafts({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET });
  await assert.rejects(
    listMyListingDrafts({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal(SELLER, RIVAL_GRANT), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.rejects(
    listMyListingDrafts({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal(RIVAL), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.rejects(
    listMyListingDrafts({ cursor: "forged.cursor", limit: 1 }, { client, principal: principal(), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  // Cursor bound to the query shape too.
  await assert.rejects(
    listMyListingDrafts({ cursor: first.nextCursor, includeSuperseded: true }, { client, principal: principal(), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
});

test("missing or short cursor secrets fail closed", async () => {
  const { client } = recordingClient({ listingDraft: { findMany: async () => [] } });
  // With a cursor in play, a missing or too-short secret is a 503 before the
  // signature is ever checked.
  await assert.rejects(
    listMyListingDrafts({ cursor: "a.b" }, { client, principal: principal(), cursorSecret: undefined }),
    { statusCode: 503 },
  );
  await assert.rejects(
    listMyListingDrafts({ cursor: "a.b" }, { client, principal: principal(), cursorSecret: "too-short" }),
    { statusCode: 503 },
  );
});

test("draft reads and saved content stay inside the published bounds", async () => {
  const stored = draftRow({
    title: "x".repeat(500),
    description: "d".repeat(5000),
    highlights: Array.from({ length: 20 }, () => "h".repeat(300)),
  });
  const { client } = recordingClient({
    listingDraft: {
      findFirst: async () => stored,
      findMany: async () => [stored],
    },
  });
  const detail = await getMyListingDraft({ draftId: "draft-1" }, { client, principal: principal() });
  assert.ok(detail.title.length <= 140);
  assert.ok(detail.description.length <= 4000);
  assert.ok(detail.highlights.length <= 10);
  assert.deepEqual(detail.status, "Draft");
  assert.equal(detail.supersedesId, null);
  assert.equal(detail.sourceProductId, "prod-1");
  const page = await listMyListingDrafts({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.ok(page.drafts[0].title.length <= 140);
});

test("get returns the full owned draft with version lineage", async () => {
  const { client } = recordingClient({
    listingDraft: { findFirst: async (args) => {
      assert.deepEqual(args.where, { id: "draft-2", sellerId: SELLER, grantId: GRANT });
      return draftRow({ id: "draft-2", version: 2, supersedesId: "draft-1", status: "Superseded" });
    } },
  });
  const detail = await getMyListingDraft({ draftId: "draft-2" }, { client, principal: principal() });
  assert.equal(detail.version, 2);
  assert.equal(detail.supersedesId, "draft-1");
  assert.equal(detail.status, "Superseded");
  assert.deepEqual(detail.highlights, ["warm light", "color: Red"]);
});

test("oversized save input is sliced to bounds before persisting", async () => {
  let createData;
  const { client } = recordingClient({
    listingDraft: { create: async (args) => { createData = args.data; return draftRow(); } },
  });
  await saveListingDraft({
    title: "t".repeat(300),
    description: "d".repeat(5000),
    highlights: Array.from({ length: 15 }, (_, i) => `h${i}`.padEnd(250, "x")),
  }, { client, principal: principal(), now });
  assert.ok(createData.title.length <= 140);
  assert.ok(createData.description.length <= 4000);
  assert.ok(createData.highlights.length <= 10);
  for (const highlight of createData.highlights) assert.ok(highlight.length <= 200);
});
