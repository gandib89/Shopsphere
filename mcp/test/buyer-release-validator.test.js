import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buyerToolDefinitions } from "../src/buyerReleaseGate.js";
import { createMcpHttpServer } from "../src/httpServer.js";
import { close, listen } from "./support/httpServer.js";

const money = { amount: "0.00", currency: "NPR" };
const order = {
  id: "order-owned",
  status: "Delivered",
  quantity: 1,
  totalPrice: money,
  createdAt: "2026-09-01T00:00:00.000Z",
  orderGroupId: null,
  productName: "Synthetic product",
};
const detail = {
  ...order,
  variants: { storage: null, color: null, ram: null, screenSize: null, processor: null },
  confirmedAt: null,
  processingAt: null,
  shippedAt: null,
  deliveredAt: "2026-09-02T00:00:00.000Z",
  cancelledAt: null,
};
const outputs = {
  get_my_profile_summary: { displayName: "Synthetic Buyer", role: "user", verified: true },
  list_my_notifications: { notifications: [], nextCursor: null },
  get_my_cart: { items: [], subtotal: money, discountTotal: money, total: money },
  validate_promo_code: {
    code: "PILOT",
    valid: false,
    reason: "not_applicable",
    discountType: null,
    discountValue: null,
    discountAmount: money,
    finalAmount: null,
  },
  preview_checkout: { items: [], subtotal: money, discountTotal: money, total: money, promo: null, promoDiscount: money },
  list_my_orders: { orders: [order], nextCursor: null },
  get_my_order: { order: detail, groupOrders: [order] },
  track_my_order: { orderId: order.id, status: order.status, timeline: [] },
  get_my_bill_summary: {
    billNumber: "bill-synthetic",
    orderId: order.id,
    productName: order.productName,
    quantity: 1,
    unitPrice: money,
    totalPrice: money,
    status: "Paid",
    orderDate: order.createdAt,
  },
  get_my_payment_status: { orderId: order.id, status: "Paid", payments: [], refunds: [] },
};

const flags = Object.fromEntries(buyerToolDefinitions.map((tool) => [tool.rollout.flag, true]));
const allScopes = [...new Set(buyerToolDefinitions.flatMap((tool) => tool.scopes))];
const jwt = (label, { subject = "buyer", role = "user", scopes = allScopes } = {}) => [
  Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    azp: "shopsphere-mcp-client",
    shopsphere_user_id: subject,
    shopsphere_role: role,
    scope: scopes.join(" "),
    sid: `grant-${label}`,
    label,
  })).toString("base64url"),
  "signature",
].join(".");
const tokens = {
  valid: jwt("valid"),
  wrongrole: jwt("wrongrole", { role: "public" }),
  wrongscope: jwt("wrongscope", { scopes: [] }),
  missing: jwt("missing", { subject: "missing" }),
  unapproved: jwt("unapproved", { subject: "new-customer" }),
  revoked: jwt("revoked"),
};
const tokenAuth = {
  [tokens.valid]: { sub: "buyer", role: "user", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-valid", scopes: allScopes },
  [tokens.wrongrole]: { sub: "buyer", role: "public", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-wrongrole", scopes: allScopes },
  [tokens.wrongscope]: { sub: "buyer", role: "user", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-wrongscope", scopes: [] },
  [tokens.missing]: { sub: "missing", role: "user", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-missing", scopes: allScopes },
  [tokens.unapproved]: { sub: "new-customer", role: "user", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-unapproved", scopes: allScopes },
};

const startBackend = async ({ disabled = false } = {}) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await new Promise((resolve) => {
      let value = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { value += chunk; });
      request.on("end", () => resolve(JSON.parse(value || "{}")));
    });
    const name = request.url?.split("/").at(-1);
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    requests.push({ name, token });
    response.setHeader("content-type", "application/json");
    if (request.headers["x-assistant-api-token"] !== "workload") return response.writeHead(401).end("{}");
    if (!token || token === "d-revoked" || token === "d-missing") return response.writeHead(401).end("{}");
    if (token === "d-wrongrole" || token === "d-wrongscope" || token === "d-unapproved") return response.writeHead(403).end("{}");
    if (disabled) return response.writeHead(404).end("{}");
    if (body.__unknown) return response.writeHead(400).end("{}");
    if (body.orderId === "order-foreign") return response.writeHead(404).end("{}");
    if (!outputs[name]) return response.writeHead(404).end("{}");
    return response.end(JSON.stringify(outputs[name]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, requests };
};

const runValidator = (env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/validate-buyer-release.js", import.meta.url))], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.resume();
  child.on("error", reject);
  child.on("close", (code) => {
    try {
      const record = stdout.split(/\r?\n/).findLast((line) => line.startsWith("SHOPSPHERE_BUYER_EVIDENCE="));
      resolve({ code, evidence: JSON.parse(record.slice("SHOPSPHERE_BUYER_EVIDENCE=".length)) });
    } catch (error) {
      if (code !== 0) resolve({ code, evidence: null });
      else reject(new Error(`Buyer validator produced invalid evidence: ${error.message}`));
    }
  });
});

test("buyer validator exercises MCP and Express matrices without leaking fixtures", async (t) => {
  const resolvedTokens = [];
  const mcp = createMcpHttpServer({
    enabled: true,
    flags,
    tokenVerifier: async (token) => {
      if (token === tokens.revoked || !tokenAuth[token]) throw Object.assign(new Error("denied"), { statusCode: 401 });
      return tokenAuth[token];
    },
    authContextResolver: async (context) => {
      resolvedTokens.push(context.subjectToken);
      if (context.subjectToken === tokens.wrongrole) throw Object.assign(new Error("forbidden"), { statusCode: 403 });
      if (context.subjectToken === tokens.missing) throw Object.assign(new Error("missing"), { statusCode: 401 });
      if (context.subjectToken === tokens.unapproved) throw Object.assign(new Error("cohort"), { statusCode: 403 });
      return { ...context, auth: tokenAuth[context.subjectToken], delegatedToken: "delegated" };
    },
    backendClient: { call: async (name, input) => {
      if (input.orderId === "order-foreign") throw Object.assign(new Error("not found"), { statusCode: 404 });
      return outputs[name];
    } },
  });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const backend = await startBackend();
  t.after(() => new Promise((resolve, reject) => backend.server.close((error) => error ? reject(error) : resolve())));

  const { code, evidence } = await runValidator({
    MCP_BUYER_MODE: "enabled",
    MCP_BUYER_URL: String(mcpUrl),
    MCP_BUYER_CLIENT_NAME: "shopsphere-mcp-client",
    MCP_BUYER_CLIENT_VERSION: "test",
    MCP_BUYER_VALID_TOKEN: tokens.valid,
    MCP_BUYER_ACCOUNT_SUBJECT: "buyer",
    MCP_BUYER_WRONG_ROLE_TOKEN: tokens.wrongrole,
    MCP_BUYER_WRONG_SCOPE_TOKEN: tokens.wrongscope,
    MCP_BUYER_REVOKED_TOKEN: tokens.revoked,
    MCP_BUYER_MISSING_ACCOUNT_TOKEN: tokens.missing,
    MCP_BUYER_UNAPPROVED_ACCOUNT_TOKEN: tokens.unapproved,
    MCP_BUYER_BACKEND_URL: backend.url,
    MCP_BUYER_BACKEND_WORKLOAD_TOKEN: "workload",
    MCP_BUYER_DELEGATED_VALID_TOKEN: "d-valid",
    MCP_BUYER_DELEGATED_WRONG_ROLE_TOKEN: "d-wrongrole",
    MCP_BUYER_DELEGATED_WRONG_SCOPE_TOKEN: "d-wrongscope",
    MCP_BUYER_DELEGATED_REVOKED_TOKEN: "d-revoked",
    MCP_BUYER_DELEGATED_MISSING_ACCOUNT_TOKEN: "d-missing",
    MCP_BUYER_DELEGATED_UNAPPROVED_ACCOUNT_TOKEN: "d-unapproved",
    MCP_BUYER_ORDER_ID: order.id,
    MCP_BUYER_FOREIGN_ORDER_ID: "order-foreign",
    MCP_BUYER_PROMO_CODE: "PILOT",
    MCP_BUYER_FORBIDDEN_MARKERS: JSON.stringify(["CANARY-PII", "credential-canary"]),
  });

  assert.equal(code, 0, JSON.stringify(evidence));
  assert.equal(evidence.outcome, "pass");
  assert.ok(evidence.checks.every(({ outcome }) => outcome === "pass"));
  assert.equal(evidence.client.id, "shopsphere-mcp-client");
  assert.doesNotMatch(JSON.stringify(evidence), /order-owned|order-foreign|PILOT|d-valid|CANARY-PII/i);
  const checks = Object.fromEntries(evidence.checks.map((item) => [item.name, item]));
  assert.equal(checks["mcp_denial:wrong_role"].sessionDenied, true);
  assert.equal(checks["mcp_denial:wrong_scope"].deniedTools, buyerToolDefinitions.length);
  assert.equal(checks["express_denial:wrong_role"].deniedRoutes, buyerToolDefinitions.length);
  assert.equal(checks["express_denial:wrong_scope"].deniedRoutes, buyerToolDefinitions.length);
  assert.equal(checks["express_denial:unapproved_account"].deniedRoutes, buyerToolDefinitions.length);
  assert.equal(resolvedTokens.filter((token) => token === tokens.wrongrole).length, 1);
  assert.ok(resolvedTokens.filter((token) => token === tokens.wrongscope).length >= buyerToolDefinitions.length);
  for (const delegatedToken of ["d-wrongrole", "d-wrongscope"]) {
    assert.deepEqual(
      backend.requests.filter(({ token }) => token === delegatedToken).map(({ name }) => name).sort(),
      [...buyerToolDefinitions.map(({ name }) => name)].sort(),
    );
  }
});

test("buyer validator rejects any OAuth client name other than shopsphere-mcp-client", async () => {
  const { code } = await runValidator({
    MCP_BUYER_CLIENT_NAME: "other-client",
    MCP_BUYER_CLIENT_VERSION: "test",
    MCP_BUYER_URL: "http://127.0.0.1:1/mcp",
  });
  assert.notEqual(code, 0);
});

test("buyer validator stops on the first failed release check", async (t) => {
  const mcp = createMcpHttpServer({
    enabled: true,
    flags,
    tokenVerifier: async () => tokenAuth[tokens.valid],
    authContextResolver: async (context) => ({ ...context, delegatedToken: "delegated" }),
  });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));

  const { code, evidence } = await runValidator({
    MCP_BUYER_MODE: "enabled",
    MCP_BUYER_URL: String(mcpUrl),
    MCP_BUYER_CLIENT_NAME: "shopsphere-mcp-client",
    MCP_BUYER_CLIENT_VERSION: "test",
    MCP_BUYER_VALID_TOKEN: tokens.valid,
    MCP_BUYER_ACCOUNT_SUBJECT: "buyer",
    MCP_BUYER_WRONG_ROLE_TOKEN: tokens.wrongrole,
    MCP_BUYER_WRONG_SCOPE_TOKEN: tokens.wrongscope,
    MCP_BUYER_REVOKED_TOKEN: tokens.revoked,
    MCP_BUYER_MISSING_ACCOUNT_TOKEN: tokens.missing,
    MCP_BUYER_UNAPPROVED_ACCOUNT_TOKEN: tokens.unapproved,
    MCP_BUYER_BACKEND_URL: "http://127.0.0.1:1",
    MCP_BUYER_BACKEND_WORKLOAD_TOKEN: "workload",
    MCP_BUYER_DELEGATED_VALID_TOKEN: "d-valid",
    MCP_BUYER_DELEGATED_WRONG_ROLE_TOKEN: "d-wrongrole",
    MCP_BUYER_DELEGATED_WRONG_SCOPE_TOKEN: "d-wrongscope",
    MCP_BUYER_DELEGATED_REVOKED_TOKEN: "d-revoked",
    MCP_BUYER_DELEGATED_MISSING_ACCOUNT_TOKEN: "d-missing",
    MCP_BUYER_DELEGATED_UNAPPROVED_ACCOUNT_TOKEN: "d-unapproved",
    MCP_BUYER_ORDER_ID: order.id,
    MCP_BUYER_FOREIGN_ORDER_ID: "order-foreign",
    MCP_BUYER_PROMO_CODE: "PILOT",
    MCP_BUYER_FORBIDDEN_MARKERS: JSON.stringify(["CANARY-PII"]),
  });

  assert.notEqual(code, 0);
  assert.equal(evidence.outcome, "fail");
  assert.deepEqual(evidence.checks.map(({ name, outcome }) => ({ name, outcome })), [
    { name: "mcp_enabled_discovery", outcome: "pass" },
    { name: "mcp_call:get_my_profile_summary", outcome: "fail" },
  ]);
});

test("buyer validator proves the global and per-route disabled state", async (t) => {
  const mcp = createMcpHttpServer({ enabled: false, flags });
  const mcpUrl = await listen(mcp);
  t.after(() => close(mcp));
  const backend = await startBackend({ disabled: true });
  t.after(() => new Promise((resolve, reject) => backend.server.close((error) => error ? reject(error) : resolve())));

  const { code, evidence } = await runValidator({
    MCP_BUYER_MODE: "disabled",
    MCP_BUYER_URL: String(mcpUrl),
    MCP_BUYER_CLIENT_NAME: "shopsphere-mcp-client",
    MCP_BUYER_CLIENT_VERSION: "test",
    MCP_BUYER_VALID_TOKEN: tokens.valid,
    MCP_BUYER_ACCOUNT_SUBJECT: "buyer",
    MCP_BUYER_BACKEND_URL: backend.url,
    MCP_BUYER_BACKEND_WORKLOAD_TOKEN: "workload",
    MCP_BUYER_DELEGATED_VALID_TOKEN: "d-valid",
    MCP_BUYER_ORDER_ID: order.id,
    MCP_BUYER_FOREIGN_ORDER_ID: "order-foreign",
    MCP_BUYER_PROMO_CODE: "PILOT",
    MCP_BUYER_FORBIDDEN_MARKERS: JSON.stringify(["CANARY-PII"]),
  });

  assert.equal(code, 0);
  assert.equal(evidence.outcome, "pass");
  assert.deepEqual(evidence.checks.map(({ name }) => name), ["mcp_disabled_discovery", "express_disabled_routes"]);
});
