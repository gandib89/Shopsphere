import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const expected = {
  get_my_cart: { roles: ["user"], scopes: ["cart:read"], operationId: "cart.getMine", path: "/api/v1/assistant/get_my_cart" },
  validate_promo_code: { roles: ["user"], scopes: ["cart:read"], operationId: "cart.validatePromo", path: "/api/v1/assistant/validate_promo_code" },
  preview_checkout: { roles: ["user"], scopes: ["cart:read"], operationId: "cart.previewCheckout", path: "/api/v1/assistant/preview_checkout" },
  list_my_orders: { roles: ["user"], scopes: ["orders:read"], operationId: "orders.listMine", path: "/api/v1/assistant/list_my_orders" },
  get_my_order: { roles: ["user"], scopes: ["orders:read"], operationId: "orders.getMine", path: "/api/v1/assistant/get_my_order" },
  track_my_order: { roles: ["user"], scopes: ["orders:read"], operationId: "orders.trackMine", path: "/api/v1/assistant/track_my_order" },
  get_my_bill_summary: { roles: ["user"], scopes: ["orders:read"], operationId: "orders.getMyBillSummary", path: "/api/v1/assistant/get_my_bill_summary" },
  get_my_payment_status: { roles: ["user"], scopes: ["orders:read"], operationId: "orders.getMyPaymentStatus", path: "/api/v1/assistant/get_my_payment_status" },
  list_my_products: { roles: ["seller"], scopes: ["catalog:read"], operationId: "products.listMine", path: "/api/v1/assistant/list_my_products" },
  get_my_product: { roles: ["seller"], scopes: ["catalog:read"], operationId: "products.getMine", path: "/api/v1/assistant/get_my_product" },
  get_my_inventory_summary: { roles: ["seller"], scopes: ["catalog:read"], operationId: "products.getMyInventorySummary", path: "/api/v1/assistant/get_my_inventory_summary" },
  list_my_seller_orders: { roles: ["seller"], scopes: ["sales:read"], operationId: "sales.listMine", path: "/api/v1/assistant/list_my_seller_orders" },
  get_my_seller_order: { roles: ["seller"], scopes: ["sales:read"], operationId: "sales.getMine", path: "/api/v1/assistant/get_my_seller_order" },
  get_my_revenue_summary: { roles: ["seller"], scopes: ["revenue:read"], operationId: "sales.revenueSummary", path: "/api/v1/assistant/get_my_revenue_summary" },
};

test("buyer and seller read tools carry closed role, scope, and backend metadata", () => {
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
  }
});

test("private read inputs reject caller-supplied totals, identity, and owner fields", () => {
  const byName = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));
  assert.ok(!byName.get_my_cart.inputSchema.safeParse({ total: "99.00" }).success);
  assert.ok(!byName.validate_promo_code.inputSchema.safeParse({ code: "X", purchaseAmount: 10 }).success);
  assert.ok(!byName.preview_checkout.inputSchema.safeParse({ promoCode: "X", total: "1" }).success);
  assert.ok(!byName.list_my_orders.inputSchema.safeParse({ userId: "victim" }).success);
  assert.ok(!byName.get_my_order.inputSchema.safeParse({ orderId: "o1", email: "v@x.test" }).success);
  assert.ok(!byName.list_my_products.inputSchema.safeParse({ sellerId: "victim" }).success);
  assert.ok(!byName.list_my_seller_orders.inputSchema.safeParse({ sellerId: "victim" }).success);
  assert.ok(!byName.get_my_seller_order.inputSchema.safeParse({ orderId: "o1", email: "v@x.test" }).success);
  assert.ok(!byName.get_my_revenue_summary.inputSchema.safeParse({ year: "2026" }).success);
  assert.ok(byName.get_my_cart.inputSchema.safeParse({}).success);
  assert.ok(byName.preview_checkout.inputSchema.safeParse({}).success);
  assert.ok(byName.list_my_seller_orders.inputSchema.safeParse({}).success);
  assert.ok(byName.get_my_revenue_summary.inputSchema.safeParse({}).success);
  assert.ok(!byName.get_my_revenue_summary.inputSchema.safeParse({ year: 1899 }).success);
  assert.ok(!byName.get_my_revenue_summary.inputSchema.safeParse({ year: 2101 }).success);
});

test("revenue summary output pins exactly twelve buckets with money semantics", () => {
  const tool = toolRegistry.find((candidate) => candidate.name === "get_my_revenue_summary");
  const bucket = (month) => ({
    month,
    saleCount: 1,
    grossSale: { amount: "100", currency: "NPR" },
    commission: { amount: "5", currency: "NPR" },
    netSale: { amount: "95", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  });
  const totals = {
    saleCount: 12,
    grossSale: { amount: "1200", currency: "NPR" },
    commission: { amount: "60", currency: "NPR" },
    netSale: { amount: "1140", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  };
  assert.ok(tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 12 }, (_, i) => bucket(i + 1)), totals }).success);
  assert.ok(!tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 11 }, (_, i) => bucket(i + 1)), totals }).success);
  assert.ok(!tool.outputSchema.safeParse({ year: 2026, buckets: Array.from({ length: 12 }, (_, i) => bucket(i + 1)), totals: { ...totals, refunded: { amount: "1", currency: "USD" } } }).success);
});

test("inventory summary output requires the truncation flag", () => {
  const tool = toolRegistry.find((candidate) => candidate.name === "get_my_inventory_summary");
  const valid = {
    threshold: 5,
    totalProducts: 80,
    totalUnits: 400,
    lowStockCount: 73,
    truncated: true,
    lowStock: [],
  };
  assert.ok(tool.outputSchema.safeParse(valid).success);
  const { truncated: _dropped, ...withoutFlag } = valid;
  assert.ok(!tool.outputSchema.safeParse(withoutFlag).success);
});

test("private reads are undiscoverable across roles, scopes, and disabled flags", () => {
  const byName = Object.fromEntries(toolRegistry.map((tool) => [tool.name, tool]));
  const enabled = Object.fromEntries(toolRegistry.map((tool) => [tool.rollout.flag, true]));
  const buyer = { role: "user", scopes: ["cart:read", "orders:read"] };
  const seller = { role: "seller", scopes: ["catalog:read"] };
  assert.ok(isToolAvailable(byName.get_my_cart, enabled, buyer));
  assert.ok(!isToolAvailable(byName.get_my_cart, enabled, seller));
  assert.ok(!isToolAvailable(byName.get_my_cart, enabled, { role: "user", scopes: [] }));
  assert.ok(isToolAvailable(byName.list_my_products, enabled, seller));
  assert.ok(!isToolAvailable(byName.list_my_products, enabled, buyer));
  assert.ok(isToolAvailable(byName.list_my_seller_orders, enabled, { role: "seller", scopes: ["sales:read"] }));
  assert.ok(!isToolAvailable(byName.list_my_seller_orders, enabled, seller));
  assert.ok(!isToolAvailable(byName.list_my_seller_orders, enabled, buyer));
  assert.ok(isToolAvailable(byName.get_my_revenue_summary, enabled, { role: "seller", scopes: ["revenue:read"] }));
  assert.ok(!isToolAvailable(byName.get_my_revenue_summary, enabled, { role: "seller", scopes: ["sales:read"] }));
  assert.ok(!isToolAvailable(byName.get_my_order, {}, buyer));
});

test("backend client exchanges narrow scopes per private read operation", async () => {
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
  await client.call("preview_checkout", {}, { subjectToken: "s" });
  await client.call("get_my_order", { orderId: "o1" }, { subjectToken: "s" });
  await client.call("get_my_inventory_summary", {}, { subjectToken: "s" });
  await client.call("list_my_seller_orders", {}, { subjectToken: "s" });
  await client.call("get_my_seller_order", { orderId: "o1" }, { subjectToken: "s" });
  await client.call("get_my_revenue_summary", {}, { subjectToken: "s" });
  assert.deepEqual(seen, [["cart:read"], ["orders:read"], ["catalog:read"], ["sales:read"], ["sales:read"], ["revenue:read"]]);
});

test("new tool flags default to disabled and parse from the environment", () => {
  const defaults = readConfig({});
  for (const tool of toolRegistry.filter((candidate) => expected[candidate.name])) {
    assert.equal(defaults.flags[tool.rollout.flag], false, tool.rollout.flag);
  }
  const enabled = readConfig({ MCP_TOOL_GET_MY_CART_ENABLED: "true", MCP_TOOL_LIST_MY_PRODUCTS_ENABLED: "true" });
  assert.equal(enabled.flags.MCP_TOOL_GET_MY_CART_ENABLED, true);
  assert.equal(enabled.flags.MCP_TOOL_LIST_MY_PRODUCTS_ENABLED, true);
  assert.equal(enabled.flags.MCP_TOOL_GET_MY_ORDER_ENABLED, false);
});
