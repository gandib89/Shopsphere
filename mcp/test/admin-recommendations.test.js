import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const SELLER_TOOL = "draft_seller_review_recommendation";
const RETURN_TOOL = "draft_return_review_recommendation";
const PROMOTION_TOOL = "draft_promotion_recommendation";
const SCOPE = "recommendations:draft";

const expected = {
  [SELLER_TOOL]: {
    roles: ["admin"],
    scopes: [SCOPE],
    operationId: "recommendations.sellerReview",
    path: "/api/v1/assistant/draft_seller_review_recommendation",
    flag: "MCP_TOOL_DRAFT_SELLER_REVIEW_RECOMMENDATION_ENABLED",
  },
  [RETURN_TOOL]: {
    roles: ["admin"],
    scopes: [SCOPE],
    operationId: "recommendations.returnReview",
    path: "/api/v1/assistant/draft_return_review_recommendation",
    flag: "MCP_TOOL_DRAFT_RETURN_REVIEW_RECOMMENDATION_ENABLED",
  },
  [PROMOTION_TOOL]: {
    roles: ["admin"],
    scopes: [SCOPE],
    operationId: "recommendations.promotionReview",
    path: "/api/v1/assistant/draft_promotion_recommendation",
    flag: "MCP_TOOL_DRAFT_PROMOTION_RECOMMENDATION_ENABLED",
  },
};

const byName = () => Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));

test("admin recommendation tools draft without deciding: draft class, closed admin role, one shared scope", () => {
  const registry = byName();
  for (const [name, wanted] of Object.entries(expected)) {
    const tool = registry[name];
    assert.ok(tool, name);
    assert.deepEqual([...tool.roles], wanted.roles, `${name} roles`);
    assert.deepEqual([...tool.scopes], wanted.scopes, `${name} scopes`);
    // Drafting is draft-class end to end: it composes text and carries the
    // stricter draft rate class, but it never decides or executes anything.
    assert.equal(tool.operationClass, "draft", `${name} class`);
    assert.equal(tool.rateClass, "draft", `${name} rate`);
    assert.equal(tool.rollout.flag, wanted.flag, `${name} flag`);
    assert.equal(tool.rollout.defaultEnabled, false, `${name} default`);
    assert.equal(tool.backendOperation.kind, "http", `${name} kind`);
    assert.equal(tool.backendOperation.operationId, wanted.operationId, `${name} op`);
    assert.equal(tool.backendOperation.method, "POST", `${name} method`);
    assert.equal(tool.backendOperation.path, wanted.path, `${name} path`);
    // Assistant draft paths only — never a storefront mutation route.
    assert.ok(wanted.path.startsWith("/api/v1/assistant/"), `${name} path`);
    assert.ok(!/verify|reject-seller|refund|toggle|reset|notify|processreturn/i.test(wanted.path), `${name} path`);
  }
});

test("seller review input carries only the opaque reference: raw ids, emails, and decisions cannot be expressed", () => {
  const registry = byName();
  const input = registry[SELLER_TOOL].inputSchema;
  assert.ok(!input.safeParse({}).success);
  assert.ok(!input.safeParse({ userId: "victim" }).success);
  assert.ok(!input.safeParse({ email: "admin@example.com" }).success);
  assert.ok(!input.safeParse({ decision: "approve" }).success);
  assert.ok(!input.safeParse({ decision: "reject" }).success);
  assert.ok(!input.safeParse({ action: "release_refund" }).success);
  assert.ok(!input.safeParse({ sellerReference: "seller-ZZZZ" }).success);
  assert.ok(!input.safeParse({ sellerReference: "seller-0123456789abcdef" }).success, "16 hex chars");
  assert.ok(!input.safeParse({ sellerReference: "user-0123456789ab" }).success);
  assert.ok(input.safeParse({ sellerReference: "seller-0123456789ab" }).success);
});

test("return review input rejects missing or short purposes and any decision fields", () => {
  const registry = byName();
  const input = registry[RETURN_TOOL].inputSchema;
  const orderId = "e2e2e2e2e2e2e2e2e2e2e2e2";
  assert.ok(!input.safeParse({}).success);
  assert.ok(!input.safeParse({ orderId }).success, "purpose is required");
  assert.ok(!input.safeParse({ orderId, purpose: "short" }).success);
  assert.ok(!input.safeParse({ orderId, purpose: "x".repeat(501) }).success);
  assert.ok(!input.safeParse({ orderId, purpose: "Preparing the weekly review", decision: "approve" }).success);
  assert.ok(!input.safeParse({ orderId, purpose: "Preparing the weekly review", action: "release_refund" }).success);
  assert.ok(!input.safeParse({ orderId, purpose: "Preparing the weekly review", refund: true }).success);
  assert.ok(!input.safeParse({ orderId, purpose: "Preparing the weekly review", email: "x@y.z" }).success);
  assert.ok(input.safeParse({ orderId, purpose: "Preparing the weekly return review" }).success);
});

test("promotion review input rejects identity, activation, reset, and notify fields", () => {
  const registry = byName();
  const input = registry[PROMOTION_TOOL].inputSchema;
  assert.ok(!input.safeParse({}).success);
  assert.ok(!input.safeParse({ promoCodeId: "p1", userId: "victim" }).success);
  assert.ok(!input.safeParse({ promoCodeId: "p1", decision: "activate" }).success);
  assert.ok(!input.safeParse({ promoCodeId: "p1", action: "reset_usage" }).success);
  assert.ok(!input.safeParse({ promoCodeId: "p1", notify: true }).success);
  assert.ok(!input.safeParse({ code: "SAVE20" }).success);
  assert.ok(input.safeParse({ promoCodeId: "f3f3f3f3f3f3f3f3f3f3f3f3" }).success);
});

test("recommendation outputs are bounded draft text with versioned citations and no decision fields", () => {
  const registry = byName();
  const output = (overrides = {}) => ({
    recommendation: "d".repeat(4000),
    truncated: false,
    citations: [{ sourceId: "faqs.json#12", sourceVersion: "1.0.0" }],
    generatedAt: "2026-09-19T10:00:00.000Z",
    ...overrides,
  });
  for (const name of Object.keys(expected)) {
    const schema = registry[name].outputSchema;
    assert.ok(schema.safeParse(output()).success, name);
    assert.ok(schema.safeParse(output({ truncated: true })).success, name);
    assert.ok(schema.safeParse(output({ citations: [] })).success, name);
    // Bounded to 4000 characters with an explicit truncation flag.
    assert.ok(!schema.safeParse(output({ recommendation: "d".repeat(4001) })).success, name);
    assert.ok(!schema.safeParse({ recommendation: "d", generatedAt: "2026-09-19T10:00:00.000Z" }).success, name);
    // Citations must be versioned policy sources.
    assert.ok(!schema.safeParse(output({ citations: [{ sourceId: "faqs.json#12" }] })).success, name);
    assert.ok(!schema.safeParse(output({ citations: [{ sourceId: "faqs.json#12", sourceVersion: "9.9.9" }] })).success, name);
    // No decision, outcome, or execution fields exist at all.
    assert.ok(!schema.safeParse(output({ decision: "approve" })).success, name);
    assert.ok(!schema.safeParse(output({ outcome: "approved" })).success, name);
    assert.ok(!schema.safeParse(output({ executed: true })).success, name);
    // No raw identity or notification affordances leak into the contract.
    assert.ok(!schema.safeParse(output({ userId: "victim" })).success, name);
    assert.ok(!schema.safeParse(output({ notifications: [] })).success, name);
  }
});

test("recommendation tools are discoverable only by fresh admins holding the recommendations:draft scope with flags on", () => {
  const registry = byName();
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const admin = { role: "admin", scopes: [SCOPE] };
  for (const name of Object.keys(expected)) {
    assert.ok(isToolAvailable(registry[name], enabled, admin), name);
    // Wrong role never discovers the tools, even with the scope.
    for (const role of ["user", "seller"]) {
      assert.ok(!isToolAvailable(registry[name], enabled, { role, scopes: [SCOPE] }), `${name}: ${role}`);
    }
    // Missing the draft scope never discovers the tools.
    for (const scopes of [[], ["profile:read", "notifications:read", "promotions:read"]]) {
      assert.ok(!isToolAvailable(registry[name], enabled, { role: "admin", scopes }), `${name}: ${scopes.join(",")}`);
    }
    // Flags default off: nothing is discoverable, even for a scoped admin.
    assert.ok(!isToolAvailable(registry[name], {}, admin), name);
  }
});

test("backend client exchanges the recommendations:draft scope for all three tools", async () => {
  const seen = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async (subjectToken, scopes) => {
      seen.push(scopes);
      return "delegated-token";
    },
    fetchImpl: async (url) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  await client.call(SELLER_TOOL, { sellerReference: "seller-0123456789ab" }, { subjectToken: "s" });
  await client.call(RETURN_TOOL, { orderId: "e2e2e2e2e2e2e2e2e2e2e2e2", purpose: "Preparing the weekly review" }, { subjectToken: "s" });
  await client.call(PROMOTION_TOOL, { promoCodeId: "f3f3f3f3f3f3f3f3f3f3f3f3" }, { subjectToken: "s" });
  assert.deepEqual(seen, [[SCOPE], [SCOPE], [SCOPE]]);
});

test("recommendation tool flags default to disabled and parse from the environment", () => {
  const defaults = readConfig({});
  for (const name of Object.keys(expected)) {
    assert.equal(defaults.flags[expected[name].flag], false, expected[name].flag);
  }
  const enabled = readConfig({
    MCP_TOOL_DRAFT_SELLER_REVIEW_RECOMMENDATION_ENABLED: "true",
    MCP_TOOL_DRAFT_RETURN_REVIEW_RECOMMENDATION_ENABLED: "true",
    MCP_TOOL_DRAFT_PROMOTION_RECOMMENDATION_ENABLED: "true",
  });
  for (const name of Object.keys(expected)) {
    assert.equal(enabled.flags[expected[name].flag], true, expected[name].flag);
  }
});
