import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sellerToolDefinitions } from "../src/sellerReleaseGate.js";
import { createMcpHttpServer } from "../src/httpServer.js";
import { fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const jwt = [
  Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ azp: "shopsphere-mcp-client", shopsphere_user_id: "seller-1", shopsphere_role: "seller", shopsphere_verified: "true", sid: "grant-valid" })).toString("base64url"),
  "signature",
].join(".");
const auth = { sub: "seller-1", role: "seller", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-valid", scopes: ["catalog:read", "sales:read", "revenue:read"] };

const backend = async () => {
  const server = http.createServer((_request, response) => response.writeHead(404, { "content-type": "application/json" }).end("{}"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
const run = (env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/validate-seller-release.js", import.meta.url))], {
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.resume();
  child.on("error", reject);
  child.on("close", (code) => {
    const line = stdout.split(/\r?\n/).findLast((entry) => entry.startsWith("SHOPSPHERE_SELLER_EVIDENCE="));
    resolve({ code, evidence: line ? JSON.parse(line.slice("SHOPSPHERE_SELLER_EVIDENCE=".length)) : null });
  });
});
const envFor = (mcpUrl, backendUrl, overrides = {}) => ({
  MCP_SELLER_MODE: "disabled",
  MCP_SELLER_URL: String(mcpUrl),
  MCP_SELLER_BACKEND_URL: backendUrl,
  MCP_SELLER_CLIENT_NAME: "shopsphere-mcp-client",
  MCP_SELLER_CLIENT_VERSION: "test",
  MCP_SELLER_VALID_TOKEN: jwt,
  MCP_SELLER_ACCOUNT_SUBJECT: "seller-1",
  MCP_SELLER_DELEGATED_VALID_TOKEN: "delegated-valid",
  MCP_SELLER_BACKEND_WORKLOAD_TOKEN: "workload",
  MCP_SELLER_OWNED_PRODUCT_ID: "product-owned",
  MCP_SELLER_FOREIGN_PRODUCT_ID: "product-foreign",
  MCP_SELLER_OWNED_ORDER_ID: "order-owned",
  MCP_SELLER_FOREIGN_ORDER_ID: "order-foreign",
  MCP_SELLER_SAME_GROUP_ORDER_ID: "order-same-group",
  MCP_SELLER_EXPECTED_PRODUCT_QUANTITY: "2",
  MCP_SELLER_EXPECTED_OPTION_STOCK: "4",
  MCP_SELLER_EXPECTED_INVENTORY_UNITS: "2",
  MCP_SELLER_EXPECTED_REVENUE_SALE_COUNT: "0",
  MCP_SELLER_EXPECTED_REVENUE_GROSS: "0.00",
  MCP_SELLER_FORBIDDEN_MARKERS: '["CANARY-PII"]',
  ...overrides,
});

test("seller validator proves all six routes disabled", async (t) => {
  const mcp = createMcpHttpServer({ enabled: false, backendClient: fakeBackendClient });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const service = await backend();
  t.after(() => new Promise((resolve) => service.server.close(resolve)));
  const result = await run(envFor(mcpUrl, service.url));
  assert.equal(result.code, 0);
  assert.equal(result.evidence.outcome, "pass");
  assert.deepEqual(result.evidence.checks.map(({ name }) => name), ["mcp_disabled", "express_disabled"]);
});

test("seller validator proves one tool flag hides discovery and denies dispatch and Express", async (t) => {
  const flags = Object.fromEntries(sellerToolDefinitions.map((tool) => [tool.rollout.flag, true]));
  flags.MCP_TOOL_GET_MY_PRODUCT_ENABLED = false;
  const mcp = createMcpHttpServer({ enabled: true, flags, backendClient: fakeBackendClient,
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-valid" }) });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const service = await backend();
  t.after(() => new Promise((resolve) => service.server.close(resolve)));
  const result = await run(envFor(mcpUrl, service.url, { MCP_SELLER_MODE: "flag", MCP_SELLER_DISABLED_TOOL: "get_my_product" }));
  assert.equal(result.code, 0);
  assert.equal(result.evidence.outcome, "pass");
  assert.deepEqual(result.evidence.checks.map(({ name }) => name), ["mcp_discovery", "mcp_flag_denial:get_my_product", "express_flag_denial:get_my_product"]);
});

test("seller validator fails closed when an enabled read is missing", async (t) => {
  const mcp = createMcpHttpServer({ enabled: true, flags: {}, backendClient: fakeBackendClient,
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-valid" }) });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const service = await backend();
  t.after(() => new Promise((resolve) => service.server.close(resolve)));
  const result = await run(envFor(mcpUrl, service.url, {
    MCP_SELLER_MODE: "flag", MCP_SELLER_DISABLED_TOOL: "get_my_product",
  }));
  assert.notEqual(result.code, 0);
  assert.equal(result.evidence.checks.at(-1).name, "mcp_discovery");
  assert.equal(result.evidence.checks.at(-1).outcome, "fail");
});

test("seller validator checks the complete enabled MCP and Express denial matrix", async (t) => {
  const money = { amount: "0.00", currency: "NPR" };
  const product = { id: "product-owned", name: "Synthetic product", price: money, quantity: 2, category: "Test", isArchived: false };
  const sale = { id: "order-owned", status: "Delivered", quantity: 1, totalPrice: money,
    createdAt: "2026-09-01T00:00:00.000Z", orderGroupId: "mixed-group", productId: "product-foreign",
    productName: product.name, buyerReference: "buyer-opaque" };
  const sameGroupSale = { ...sale, id: "order-same-group" };
  const outputs = {
    list_my_products: { products: [product], nextCursor: null },
    get_my_product: { ...product, description: "Synthetic", images: [], discount: "0.00", createdAt: null,
      options: [{ kind: "color", value: "Red", priceDelta: money, stock: 4 }] },
    get_my_inventory_summary: { threshold: 5, totalProducts: 1, totalUnits: 2, lowStockCount: 1, truncated: false,
      lowStock: [{ productId: product.id, name: product.name, quantity: 2 }] },
    list_my_seller_orders: { sales: [sale], nextCursor: null },
    get_my_seller_order: { sale: { ...sale,
      variants: { storage: null, color: null, ram: null, screenSize: null, processor: null },
      confirmedAt: null, processingAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null,
      revenue: { status: "Completed", grossSale: money, commission: money, netSale: money } }, groupSales: [sameGroupSale] },
    get_my_revenue_summary: { year: 2026,
      buckets: Array.from({ length: 12 }, (_, month) => ({ month: month + 1, saleCount: 0,
        grossSale: money, commission: money, netSale: money, refunded: money })),
      totals: { saleCount: 0, grossSale: money, commission: money, netSale: money, refunded: money } },
  };
  const scenarioJwt = (label, { subject = "seller-1", role = "seller", verified = "true", scope = "catalog:read sales:read revenue:read" } = {}) => [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ azp: "shopsphere-mcp-client", shopsphere_user_id: subject,
      shopsphere_role: role, shopsphere_verified: verified, scope, sid: `grant-${label}` })).toString("base64url"),
    "signature",
  ].join(".");
  const fixtures = {
    valid: scenarioJwt("valid"),
    unverified: scenarioJwt("unverified", { subject: "seller-unverified", verified: "false" }),
    wrongrole: scenarioJwt("wrongrole", { role: "user" }),
    wrongscope: scenarioJwt("wrongscope", { scope: "openid" }),
    revoked: scenarioJwt("revoked"),
    missing: scenarioJwt("missing", { subject: "missing" }),
    unapproved: scenarioJwt("unapproved", { subject: "seller-new" }),
  };
  const authByToken = Object.fromEntries([
    [fixtures.valid, auth],
    [fixtures.unverified, { ...auth, sub: "seller-unverified", verified: false, grantId: "grant-unverified" }],
    [fixtures.wrongrole, { ...auth, role: "user", grantId: "grant-wrongrole" }],
    [fixtures.wrongscope, { ...auth, scopes: ["openid"], grantId: "grant-wrongscope" }],
  ]);
  const flags = Object.fromEntries(sellerToolDefinitions.map((tool) => [tool.rollout.flag, true]));
  const mcp = createMcpHttpServer({ enabled: true, flags, requestsPerMinute: 200,
    backendClient: { call: async (name, input) => {
      if (input.productId === "product-foreign" || input.orderId === "order-foreign") {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }
      return outputs[name];
    } },
    tokenVerifier: async (token) => {
      if (token === fixtures.unapproved) throw Object.assign(new Error("denied"), { statusCode: 403 });
      if (!authByToken[token]) throw Object.assign(new Error("denied"), { statusCode: 401 });
      return authByToken[token];
    },
    authContextResolver: async (context) => ({ ...context, delegatedToken: "delegated-valid" }) });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const backendServer = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body || "{}");
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    const name = request.url?.split("/").at(-1);
    response.setHeader("content-type", "application/json");
    const status = !token || ["d-revoked", "d-missing"].includes(token) ? 401
      : ["d-unverified", "d-wrongrole", "d-wrongscope", "d-unapproved"].includes(token) ? 403
        : input.__unknown ? 400
          : input.productId === "product-foreign" || input.orderId === "order-foreign" ? 404 : 200;
    response.writeHead(status).end(JSON.stringify(status === 200 ? outputs[name]
      : token === "d-unverified" ? { code: "seller_not_verified" } : {}));
  });
  await new Promise((resolve) => backendServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => backendServer.close(resolve)));
  const backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
  const result = await run(envFor(mcpUrl, backendUrl, {
    MCP_SELLER_MODE: "enabled", MCP_SELLER_VALID_TOKEN: fixtures.valid,
    MCP_SELLER_UNVERIFIED_TOKEN: fixtures.unverified,
    MCP_SELLER_WRONG_ROLE_TOKEN: fixtures.wrongrole,
    MCP_SELLER_WRONG_SCOPE_TOKEN: fixtures.wrongscope,
    MCP_SELLER_REVOKED_TOKEN: fixtures.revoked,
    MCP_SELLER_MISSING_ACCOUNT_TOKEN: fixtures.missing,
    MCP_SELLER_UNAPPROVED_ACCOUNT_TOKEN: fixtures.unapproved,
    MCP_SELLER_DELEGATED_UNVERIFIED_TOKEN: "d-unverified",
    MCP_SELLER_DELEGATED_WRONG_ROLE_TOKEN: "d-wrongrole",
    MCP_SELLER_DELEGATED_WRONG_SCOPE_TOKEN: "d-wrongscope",
    MCP_SELLER_DELEGATED_REVOKED_TOKEN: "d-revoked",
    MCP_SELLER_DELEGATED_MISSING_ACCOUNT_TOKEN: "d-missing",
    MCP_SELLER_DELEGATED_UNAPPROVED_ACCOUNT_TOKEN: "d-unapproved",
  }));
  assert.equal(result.code, 0);
  assert.equal(result.evidence.outcome, "pass");
  for (const scenario of ["unverified_seller", "wrong_role", "wrong_scope", "revoked", "missing_account", "unapproved_account"]) {
    assert.equal(result.evidence.checks.find(({ name }) => name === `mcp_denial:${scenario}`)?.outcome, "pass");
    assert.equal(result.evidence.checks.find(({ name }) => name === `express_denial:${scenario}`)?.outcome, "pass");
  }
});
