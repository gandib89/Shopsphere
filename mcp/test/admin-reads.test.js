import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const expected = {
  get_platform_revenue_summary: {
    roles: ["admin"],
    scopes: ["platform:read"],
    operationId: "platform.revenueSummary",
    path: "/api/v1/assistant/get_platform_revenue_summary",
  },
  list_seller_applications: {
    roles: ["admin"],
    scopes: ["sellers:read"],
    operationId: "sellers.listApplications",
    path: "/api/v1/assistant/list_seller_applications",
  },
};

test("admin read tools carry closed role, scope, and backend metadata", () => {
  for (const [name, wanted] of Object.entries(expected)) {
    const tool = toolRegistry.find((candidate) => candidate.name === name);
    assert.ok(tool, name);
    assert.deepEqual([...tool.roles], wanted.roles, `${name} roles`);
    assert.deepEqual([...tool.scopes], wanted.scopes, `${name} scopes`);
    assert.equal(tool.operationClass, "read", `${name} class`);
    assert.equal(tool.rateClass, "authenticated-read", `${name} rate`);
    assert.equal(tool.backendOperation.kind, "http", `${name} kind`);
    assert.equal(tool.backendOperation.operationId, wanted.operationId, `${name} op`);
    assert.equal(tool.backendOperation.path, wanted.path, `${name} path`);
    assert.equal(tool.rollout.defaultEnabled, false, `${name} ships dark`);
  }
});

test("admin read inputs reject identity fields, caller ids, and mistyped bounds", () => {
  const byName = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));
  // No caller-supplied identity or selector fields exist anywhere.
  assert.ok(!byName.list_seller_applications.inputSchema.safeParse({ sellerEmail: "x" }).success);
  assert.ok(!byName.list_seller_applications.inputSchema.safeParse({ sellerId: "victim" }).success);
  assert.ok(!byName.list_seller_applications.inputSchema.safeParse({ status: "Verified" }).success);
  assert.ok(!byName.list_seller_applications.inputSchema.safeParse({ status: "pending", email: "v@x.test" }).success);
  assert.ok(!byName.get_platform_revenue_summary.inputSchema.safeParse({ year: "2026" }).success);
  assert.ok(!byName.get_platform_revenue_summary.inputSchema.safeParse({ sellerEmail: "x" }).success);
  assert.ok(!byName.get_platform_revenue_summary.inputSchema.safeParse({ includeRawLedger: true }).success);
  // Valid inputs parse; the year is bounded like the seller revenue summary.
  assert.ok(byName.get_platform_revenue_summary.inputSchema.safeParse({}).success);
  assert.ok(byName.get_platform_revenue_summary.inputSchema.safeParse({ year: 2026 }).success);
  assert.ok(!byName.get_platform_revenue_summary.inputSchema.safeParse({ year: 1899 }).success);
  assert.ok(!byName.get_platform_revenue_summary.inputSchema.safeParse({ year: 2101 }).success);
  assert.ok(byName.list_seller_applications.inputSchema.safeParse({}).success);
  assert.ok(byName.list_seller_applications.inputSchema.safeParse({ status: "rejected", limit: 50 }).success);
  assert.ok(!byName.list_seller_applications.inputSchema.safeParse({ limit: 51 }).success);
});

test("platform revenue output pins exactly twelve bounded aggregate buckets", () => {
  const tool = toolRegistry.find((candidate) => candidate.name === "get_platform_revenue_summary");
  const bucket = (month) => ({
    month,
    completedSaleCount: 1,
    grossSale: { amount: "100", currency: "NPR" },
    adminCommission: { amount: "5", currency: "NPR" },
    sellerRevenue: { amount: "95", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  });
  const totals = {
    completedSaleCount: 12,
    grossSale: { amount: "1200", currency: "NPR" },
    adminCommission: { amount: "60", currency: "NPR" },
    sellerRevenue: { amount: "1140", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  };
  assert.ok(tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 12 }, (_, i) => bucket(i + 1)), totals }).success);
  assert.ok(!tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 11 }, (_, i) => bucket(i + 1)), totals }).success);
  // No raw-row fields can slip through the strict output contract.
  assert.ok(!tool.outputSchema.safeParse({
    year: 2026,
    buckets: Array.from({ length: 12 }, (_, i) => ({ ...bucket(i + 1), orderId: "row-1" })),
    totals,
  }).success);
  assert.ok(!tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 12 }, (_, i) => bucket(i + 1)), totals: { ...totals, grossSale: { amount: "1", currency: "USD" } } }).success);
});

test("seller application output is a bounded minimized projection with opaque references", () => {
  const tool = toolRegistry.find((candidate) => candidate.name === "list_seller_applications");
  const application = {
    sellerReference: "seller-0123456789ab",
    shopName: "Ben's Shop",
    shopDescription: "Handmade goods",
    status: "pending",
    requestDate: "2026-08-01T08:00:00.000Z",
    decisionDate: null,
    rejectionReason: null,
  };
  const output = { applications: Array.from({ length: 50 }, () => application), nextCursor: null };
  assert.ok(tool.outputSchema.safeParse(output).success);
  assert.ok(!tool.outputSchema.safeParse({ ...output, applications: Array.from({ length: 51 }, () => application) }).success);
  // Strictness: no identity, contact, evidence, or raw-account fields.
  assert.ok(!tool.outputSchema.safeParse({
    applications: [{ ...application, email: "owner@example.test" }],
    nextCursor: null,
  }).success);
  assert.ok(!tool.outputSchema.safeParse({
    applications: [{ ...application, sellerReference: "seller-<raw-id>" }],
    nextCursor: null,
  }).success);
  assert.ok(!tool.outputSchema.safeParse({
    applications: [{ ...application, status: "unverified" }],
    nextCursor: null,
  }).success);
});

test("admin reads are undiscoverable without the admin role, the exact scope, or the flag", () => {
  const byName = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const admin = { role: "admin", scopes: ["platform:read", "sellers:read"] };
  const narrowAdmin = { role: "admin", scopes: ["profile:read"] };
  const seller = { role: "seller", scopes: ["revenue:read", "sales:read"] };
  const buyer = { role: "user", scopes: ["orders:read"] };
  assert.ok(isToolAvailable(byName.get_platform_revenue_summary, enabled, admin));
  assert.ok(isToolAvailable(byName.list_seller_applications, enabled, admin));
  // A promoted user with an older narrower grant cannot even discover them.
  assert.ok(!isToolAvailable(byName.get_platform_revenue_summary, enabled, narrowAdmin));
  assert.ok(!isToolAvailable(byName.list_seller_applications, enabled, narrowAdmin));
  assert.ok(!isToolAvailable(byName.get_platform_revenue_summary, enabled, seller));
  assert.ok(!isToolAvailable(byName.list_seller_applications, enabled, buyer));
  // Disabled flags hide the tools from every caller.
  assert.ok(!isToolAvailable(byName.get_platform_revenue_summary, {}, admin));
  assert.ok(!isToolAvailable(byName.list_seller_applications, {}, admin));
});

test("backend client exchanges the narrow per-tool scope for each admin read", async () => {
  const seen = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    exchangeToken: async (subjectToken, scopes) => {
      seen.push(scopes);
      return "delegated-token";
    },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  await client.call("get_platform_revenue_summary", { year: 2026 }, { subjectToken: "s" });
  await client.call("list_seller_applications", { status: "pending" }, { subjectToken: "s" });
  assert.deepEqual(seen, [["platform:read"], ["sellers:read"]]);
});

test("admin tool rollout flags default to disabled and parse from the environment", () => {
  const defaults = readConfig({});
  for (const name of Object.keys(expected)) {
    const tool = toolRegistry.find((candidate) => candidate.name === name);
    assert.equal(defaults.flags[tool.rollout.flag], false, tool.rollout.flag);
  }
  const enabled = readConfig({
    MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED: "true",
    MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED: "true",
  });
  assert.equal(enabled.flags.MCP_TOOL_GET_PLATFORM_REVENUE_SUMMARY_ENABLED, true);
  assert.equal(enabled.flags.MCP_TOOL_LIST_SELLER_APPLICATIONS_ENABLED, true);
});
