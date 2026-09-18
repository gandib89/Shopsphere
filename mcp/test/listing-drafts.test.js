import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { POLICY_VERSION, isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const expected = {
  draft_listing_copy: { roles: ["seller"], scopes: ["listings:draft"], operationId: "listings.draftCopy", path: "/api/v1/assistant/draft_listing_copy" },
  save_listing_draft: { roles: ["seller"], scopes: ["listings:draft"], operationId: "listings.saveDraft", path: "/api/v1/assistant/save_listing_draft" },
  list_my_listing_drafts: { roles: ["seller"], scopes: ["listings:draft"], operationId: "listings.listDrafts", path: "/api/v1/assistant/list_my_listing_drafts" },
  get_my_listing_draft: { roles: ["seller"], scopes: ["listings:draft"], operationId: "listings.getDraft", path: "/api/v1/assistant/get_my_listing_draft" },
};

const byName = () => Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));

test("listing draft tools carry closed role, scope, and backend metadata", () => {
  for (const [name, wanted] of Object.entries(expected)) {
    const tool = toolRegistry.find((candidate) => candidate.name === name);
    assert.ok(tool, name);
    assert.deepEqual([...tool.roles], wanted.roles, `${name} roles`);
    assert.deepEqual([...tool.scopes], wanted.scopes, `${name} scopes`);
    assert.equal(tool.operationClass, "draft", `${name} class`);
    assert.equal(tool.rateClass, "draft", `${name} rate`);
    assert.equal(tool.rollout.flag, `MCP_TOOL_${name.toUpperCase()}_ENABLED`, `${name} flag`);
    assert.equal(tool.rollout.defaultEnabled, false, `${name} default`);
    assert.equal(tool.backendOperation.kind, "http", `${name} kind`);
    assert.equal(tool.backendOperation.operationId, wanted.operationId, `${name} op`);
    assert.equal(tool.backendOperation.method, "POST", `${name} method`);
    assert.equal(tool.backendOperation.path, wanted.path, `${name} path`);
  }
});

test("draft tool inputs are strict and reject caller-supplied owner and control fields", () => {
  const registry = byName();
  for (const name of Object.keys(expected)) {
    assert.ok(!registry[name].inputSchema.safeParse({ publish: true }).success, `${name} publish`);
    assert.ok(!registry[name].inputSchema.safeParse({ sellerId: "victim" }).success, `${name} sellerId`);
    assert.ok(!registry[name].inputSchema.safeParse({ isVerified: true }).success, `${name} isVerified`);
    assert.ok(!registry[name].inputSchema.safeParse({ status: "Published" }).success, `${name} status`);
  }
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({}).success, "draft copy needs an input");
  assert.ok(registry.draft_listing_copy.inputSchema.safeParse({ sourceProductId: "prod-1" }).success);
  assert.ok(registry.draft_listing_copy.inputSchema.safeParse({ facts: {} }).success);
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({ facts: { condition: "mint" } }).success);
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({ facts: { warranty: "lifetime" } }).success);
  assert.ok(!registry.save_listing_draft.inputSchema.safeParse({ description: "d" }).success, "save needs title");
  assert.ok(!registry.save_listing_draft.inputSchema.safeParse({ title: "t", publish: "now" }).success);
  assert.ok(registry.list_my_listing_drafts.inputSchema.safeParse({}).success);
  assert.ok(!registry.list_my_listing_drafts.inputSchema.safeParse({ includeSuperseded: "yes" }).success);
  assert.ok(!registry.get_my_listing_draft.inputSchema.safeParse({}).success, "get needs draftId");
});

test("draft tool inputs enforce string, array, and policy-claim bounds", () => {
  const registry = byName();
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({
    facts: { productName: "x".repeat(141) },
  }).success);
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({
    facts: { keyFeatures: Array.from({ length: 11 }, (_, i) => `f${i}`) },
  }).success);
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({
    facts: { keyFeatures: ["x".repeat(201)] },
  }).success);
  assert.ok(!registry.draft_listing_copy.inputSchema.safeParse({
    facts: { audienceNote: "x".repeat(301) },
  }).success);
  assert.ok(!registry.save_listing_draft.inputSchema.safeParse({
    title: "t",
    description: "x".repeat(4001),
  }).success);
  assert.ok(!registry.save_listing_draft.inputSchema.safeParse({
    title: "t",
    description: "d",
    highlights: Array.from({ length: 11 }, () => "h"),
  }).success);
});

test("draft tool outputs are bounded and pin policy citation versions", () => {
  const registry = byName();
  const citations = [{ sourceId: "faqs.json#6", sourceVersion: POLICY_VERSION }];
  const base = {
    title: "Bounded title",
    description: "Bounded description",
    highlights: ["feature one"],
    citations,
    generatedAt: "2026-09-19T04:00:00.000Z",
  };
  assert.ok(registry.draft_listing_copy.outputSchema.safeParse(base).success);
  assert.ok(!registry.draft_listing_copy.outputSchema.safeParse({ ...base, title: "x".repeat(141) }).success);
  assert.ok(!registry.draft_listing_copy.outputSchema.safeParse({ ...base, description: "x".repeat(4001) }).success);
  assert.ok(!registry.draft_listing_copy.outputSchema.safeParse({ ...base, highlights: Array.from({ length: 11 }, () => "h") }).success);
  assert.ok(!registry.draft_listing_copy.outputSchema.safeParse({
    ...base,
    citations: [{ sourceId: "faqs.json#6", sourceVersion: "9.9.9" }],
  }).success);
  assert.ok(!registry.draft_listing_copy.outputSchema.safeParse({ ...base, generatedAt: "not-a-date" }).success);

  const saved = { draftId: "draft-1", version: 2, status: "Draft", savedAt: "2026-09-19T04:00:00.000Z" };
  assert.ok(registry.save_listing_draft.outputSchema.safeParse(saved).success);
  assert.ok(!registry.save_listing_draft.outputSchema.safeParse({ ...saved, status: "Published" }).success);
  assert.ok(!registry.save_listing_draft.outputSchema.safeParse({ ...saved, version: 0 }).success);

  const summary = {
    draftId: "draft-1",
    title: "Bounded title",
    status: "Superseded",
    version: 1,
    sourceProductId: null,
    createdAt: "2026-09-19T04:00:00.000Z",
    updatedAt: "2026-09-19T04:00:00.000Z",
  };
  assert.ok(registry.list_my_listing_drafts.outputSchema.safeParse({ drafts: [summary], nextCursor: null }).success);
  assert.ok(!registry.list_my_listing_drafts.outputSchema.safeParse({
    drafts: Array.from({ length: 51 }, () => summary),
    nextCursor: null,
  }).success);
  assert.ok(!registry.list_my_listing_drafts.outputSchema.safeParse({ ...summary, title: "x".repeat(141) }).success);

  const detail = {
    draftId: "draft-1",
    title: "Bounded title",
    description: "Bounded description",
    highlights: [],
    status: "Draft",
    version: 1,
    supersedesId: null,
    sourceProductId: "prod-1",
    createdAt: "2026-09-19T04:00:00.000Z",
    updatedAt: "2026-09-19T04:00:00.000Z",
  };
  assert.ok(registry.get_my_listing_draft.outputSchema.safeParse(detail).success);
  assert.ok(!registry.get_my_listing_draft.outputSchema.safeParse({ ...detail, highlights: Array.from({ length: 11 }, () => "h") }).success);
  assert.ok(!registry.get_my_listing_draft.outputSchema.safeParse({ ...detail, supersedesId: 5 }).success);
});

test("draft tools are undiscoverable across roles, scopes, and disabled flags", () => {
  const registry = byName();
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const seller = { role: "seller", scopes: ["listings:draft"] };
  const unverifiedSeller = { role: "seller", scopes: ["listings:draft"] };
  const buyer = { role: "user", scopes: ["listings:draft"] };
  const sellerWithoutScope = { role: "seller", scopes: ["catalog:read"] };
  for (const name of Object.keys(expected)) {
    assert.ok(isToolAvailable(registry[name], enabled, seller), `${name} seller`);
    // Verification is not part of discovery: an unverified seller with the
    // granted scope may draft and gets no live catalog-change authority.
    assert.ok(isToolAvailable(registry[name], enabled, unverifiedSeller), `${name} unverified seller`);
    assert.ok(!isToolAvailable(registry[name], enabled, buyer), `${name} buyer`);
    assert.ok(!isToolAvailable(registry[name], enabled, sellerWithoutScope), `${name} missing scope`);
    assert.ok(!isToolAvailable(registry[name], {}, seller), `${name} flag off`);
  }
});

test("backend client exchanges the draft scope for each draft operation", async () => {
  const seen = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async (subjectToken, scopes) => {
      seen.push(scopes);
      return "delegated-token";
    },
    fetchImpl: async (url, init) => {
      seen.push(String(url).replace("http://backend:4000", ""));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.call("draft_listing_copy", { facts: {} }, { subjectToken: "s" });
  await client.call("save_listing_draft", { title: "t", description: "d" }, { subjectToken: "s" });
  await client.call("list_my_listing_drafts", {}, { subjectToken: "s" });
  await client.call("get_my_listing_draft", { draftId: "d1" }, { subjectToken: "s" });
  assert.deepEqual(seen, [
    ["listings:draft"], "/api/v1/assistant/draft_listing_copy",
    ["listings:draft"], "/api/v1/assistant/save_listing_draft",
    ["listings:draft"], "/api/v1/assistant/list_my_listing_drafts",
    ["listings:draft"], "/api/v1/assistant/get_my_listing_draft",
  ]);
});

test("draft tool flags default to disabled and parse from the environment", () => {
  const defaults = readConfig({});
  for (const name of Object.keys(expected)) {
    const tool = toolRegistry.find((candidate) => candidate.name === name);
    assert.equal(defaults.flags[tool.rollout.flag], false, tool.rollout.flag);
  }
  const enabled = readConfig({
    MCP_TOOL_DRAFT_LISTING_COPY_ENABLED: "true",
    MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED: "true",
  });
  assert.equal(enabled.flags.MCP_TOOL_DRAFT_LISTING_COPY_ENABLED, true);
  assert.equal(enabled.flags.MCP_TOOL_SAVE_LISTING_DRAFT_ENABLED, true);
  assert.equal(enabled.flags.MCP_TOOL_LIST_MY_LISTING_DRAFTS_ENABLED, false);
  assert.equal(enabled.flags.MCP_TOOL_GET_MY_LISTING_DRAFT_ENABLED, false);
});
