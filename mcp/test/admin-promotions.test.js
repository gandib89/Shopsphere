import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const LIST_TOOL = "list_promotion_configuration";
const SUMMARY_TOOL = "get_promotion_usage_summary";

const expected = {
  [LIST_TOOL]: {
    roles: ["admin"],
    scopes: ["promotions:read"],
    operationId: "promotions.listConfiguration",
    path: "/api/v1/assistant/list_promotion_configuration",
    flag: "MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED",
  },
  [SUMMARY_TOOL]: {
    roles: ["admin"],
    scopes: ["promotions:read"],
    operationId: "promotions.usageSummary",
    path: "/api/v1/assistant/get_promotion_usage_summary",
    flag: "MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED",
  },
};

const byName = () => Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));

test("admin promotion tools carry closed admin role, promotion scope, and backend metadata", () => {
  const registry = byName();
  for (const [name, wanted] of Object.entries(expected)) {
    const tool = registry[name];
    assert.ok(tool, name);
    assert.deepEqual([...tool.roles], wanted.roles, `${name} roles`);
    assert.deepEqual([...tool.scopes], wanted.scopes, `${name} scopes`);
    assert.equal(tool.operationClass, "read", `${name} class`);
    assert.equal(tool.rateClass, "authenticated-read", `${name} rate`);
    assert.equal(tool.rollout.flag, wanted.flag, `${name} flag`);
    assert.equal(tool.rollout.defaultEnabled, false, `${name} default`);
    assert.equal(tool.backendOperation.kind, "http", `${name} kind`);
    assert.equal(tool.backendOperation.operationId, wanted.operationId, `${name} op`);
    assert.equal(tool.backendOperation.path, wanted.path, `${name} path`);
    // Assistant read paths only — never an existing storefront promotion
    // mutation route.
    assert.ok(wanted.path.startsWith("/api/v1/assistant/"), `${name} path`);
    assert.ok(!/toggle|delete|reset|notify|create|update/i.test(wanted.path), `${name} path`);
  }
});

test("promotion inputs reject caller-supplied identity, owner, and mutation fields", () => {
  const registry = byName();
  const list = registry[LIST_TOOL].inputSchema;
  assert.ok(!list.safeParse({ userId: "x" }).success);
  assert.ok(!list.safeParse({ createdById: "x" }).success);
  assert.ok(!list.safeParse({ code: "SAVE20" }).success);
  assert.ok(!list.safeParse({ isActive: true }).success);
  assert.ok(!list.safeParse({ activeOnly: "yes" }).success);
  assert.ok(!list.safeParse({ limit: 51 }).success);
  assert.ok(!list.safeParse({ limit: 0 }).success);
  assert.ok(list.safeParse({}).success);
  assert.ok(list.safeParse({ activeOnly: true }).success);
  assert.ok(list.safeParse({ limit: 50 }).success);

  const summary = registry[SUMMARY_TOOL].inputSchema;
  assert.ok(!summary.safeParse({}).success);
  assert.ok(!summary.safeParse({ promoCodeId: "p1", userId: "victim" }).success);
  assert.ok(!summary.safeParse({ orderId: "o1" }).success);
  assert.ok(!summary.safeParse({ code: "SAVE20" }).success);
  assert.ok(summary.safeParse({ promoCodeId: "f9f9f9f9f9f9f9f9f9f9f9f9" }).success);
});

test("configuration output allowlists fields and forbids per-user redemption data", () => {
  const schema = byName()[LIST_TOOL].outputSchema;
  const promotion = (overrides = {}) => ({
    promoCodeId: "f9f9f9f9f9f9f9f9f9f9f9f9",
    code: "SAVE20",
    discountType: "percentage",
    discountValue: { percent: "20" },
    minPurchase: { amount: "100", currency: "NPR" },
    maxDiscount: null,
    usageLimit: null,
    usedCount: 3,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-12-31T00:00:00.000Z",
    isActive: true,
    ...overrides,
  });
  assert.ok(schema.safeParse({ promotions: [promotion()], nextCursor: null }).success);
  assert.ok(schema.safeParse({ promotions: [promotion()], nextCursor: "cursor" }).success);
  // Fixed discounts use the money contract; percentages must stay within 0..100.
  assert.ok(schema.safeParse({ promotions: [promotion({ discountType: "fixed", discountValue: { amount: "150.75", currency: "NPR" } })], nextCursor: null }).success);
  assert.ok(!schema.safeParse({ promotions: [promotion({ discountValue: { percent: "150" } })], nextCursor: null }).success);
  assert.ok(!schema.safeParse({ promotions: [promotion({ discountValue: { percent: "-1" } })], nextCursor: null }).success);
  // Money is NPR-denominated only.
  assert.ok(!schema.safeParse({ promotions: [promotion({ discountType: "fixed", discountValue: { amount: "5", currency: "USD" } })], nextCursor: null }).success);
  assert.ok(!schema.safeParse({ promotions: [promotion({ minPurchase: { amount: "5", currency: "USD" } })], nextCursor: null }).success);
  // Creator identity and per-user redemption history have no field at all.
  assert.ok(!schema.safeParse({ promotions: [promotion({ createdById: "admin-1" })], nextCursor: null }).success);
  assert.ok(!schema.safeParse({
    promotions: [promotion()],
    nextCursor: null,
    redemptions: [{ userId: "user-1", redeemedAt: "2026-09-10T00:00:00.000Z" }],
  }).success);
  assert.ok(!schema.safeParse({ promotions: [promotion({ usages: [{ userId: "user-1" }] })], nextCursor: null }).success);
});

test("usage summary output is aggregate-only", () => {
  const schema = byName()[SUMMARY_TOOL].outputSchema;
  const summary = (overrides = {}) => ({
    promoCodeId: "f9f9f9f9f9f9f9f9f9f9f9f9",
    code: "SAVE20",
    totalRedemptions: 12,
    distinctUsers: 9,
    active: true,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-12-31T00:00:00.000Z",
    ...overrides,
  });
  assert.ok(schema.safeParse(summary()).success);
  assert.ok(schema.safeParse(summary({ validUntil: null })).success);
  assert.ok(!schema.safeParse(summary({ totalRedemptions: -1 })).success);
  assert.ok(!schema.safeParse(summary({ distinctUsers: 1.5 })).success);
  // No per-user rows, user ids, or user-bound redemption timestamps.
  assert.ok(!schema.safeParse(summary({ redemptions: [{ userId: "user-1" }] })).success);
  assert.ok(!schema.safeParse(summary({ lastRedeemedAt: "2026-09-10T00:00:00.000Z" })).success);
  assert.ok(!schema.safeParse(summary({ usages: 9 })).success);
});

test("promotion tools are discoverable only by fresh admins holding the promotion scope with flags on", () => {
  const registry = byName();
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const admin = { role: "admin", scopes: ["promotions:read"] };
  assert.ok(isToolAvailable(registry[LIST_TOOL], enabled, admin));
  assert.ok(isToolAvailable(registry[SUMMARY_TOOL], enabled, admin));
  // Wrong role never discovers the tools, even with the scope.
  for (const role of ["user", "seller"]) {
    assert.ok(!isToolAvailable(registry[LIST_TOOL], enabled, { role, scopes: ["promotions:read"] }), role);
    assert.ok(!isToolAvailable(registry[SUMMARY_TOOL], enabled, { role, scopes: ["promotions:read"] }), role);
  }
  // Missing the promotion-read scope never discovers the tools.
  for (const scopes of [[], ["profile:read", "notifications:read"]]) {
    assert.ok(!isToolAvailable(registry[LIST_TOOL], enabled, { role: "admin", scopes }));
    assert.ok(!isToolAvailable(registry[SUMMARY_TOOL], enabled, { role: "admin", scopes }));
  }
  // Flags default off: nothing is discoverable, even for a scoped admin.
  assert.ok(!isToolAvailable(registry[LIST_TOOL], {}, admin));
  assert.ok(!isToolAvailable(registry[SUMMARY_TOOL], {}, admin));
});

test("backend client exchanges the promotion-read scope for both admin tools", async () => {
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
  await client.call(LIST_TOOL, {}, { subjectToken: "s" });
  await client.call(SUMMARY_TOOL, { promoCodeId: "f9f9f9f9f9f9f9f9f9f9f9f9" }, { subjectToken: "s" });
  assert.deepEqual(seen, [["promotions:read"], ["promotions:read"]]);
});

test("promotion tool flags default to disabled and parse from the environment", () => {
  const defaults = readConfig({});
  assert.equal(defaults.flags[expected[LIST_TOOL].flag], false, expected[LIST_TOOL].flag);
  assert.equal(defaults.flags[expected[SUMMARY_TOOL].flag], false, expected[SUMMARY_TOOL].flag);
  const enabled = readConfig({
    MCP_TOOL_LIST_PROMOTION_CONFIGURATION_ENABLED: "true",
    MCP_TOOL_GET_PROMOTION_USAGE_SUMMARY_ENABLED: "true",
  });
  assert.equal(enabled.flags[expected[LIST_TOOL].flag], true);
  assert.equal(enabled.flags[expected[SUMMARY_TOOL].flag], true);
});
