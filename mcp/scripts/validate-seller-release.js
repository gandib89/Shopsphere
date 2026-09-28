import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { SELLER_TOOL_NAMES, sellerToolDefinitions } from "../src/sellerReleaseGate.js";
import { DEFAULT_MAX_RESPONSE_BYTES } from "../src/toolRegistry.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const optional = (name) => process.env[name] || null;
const mode = process.env.MCP_SELLER_MODE ?? "enabled";
if (!["disabled", "enabled", "flag"].includes(mode)) throw new Error("MCP_SELLER_MODE must be disabled, enabled, or flag");
const disabledTool = mode === "flag" ? required("MCP_SELLER_DISABLED_TOOL") : null;
if (disabledTool && !SELLER_TOOL_NAMES.includes(disabledTool)) throw new Error("MCP_SELLER_DISABLED_TOOL must name a seller read");
const rateWaitMs = Number(process.env.MCP_SELLER_RATE_WINDOW_WAIT_MS ?? "0");
if (!Number.isInteger(rateWaitMs) || rateWaitMs < 0 || rateWaitMs > 120_000) throw new Error("Invalid MCP_SELLER_RATE_WINDOW_WAIT_MS");

const config = {
  endpoint: new URL(required("MCP_SELLER_URL")),
  backendUrl: new URL(required("MCP_SELLER_BACKEND_URL")),
  clientName: required("MCP_SELLER_CLIENT_NAME"),
  clientVersion: required("MCP_SELLER_CLIENT_VERSION"),
  validToken: required("MCP_SELLER_VALID_TOKEN"),
  subject: required("MCP_SELLER_ACCOUNT_SUBJECT"),
  delegatedValid: required("MCP_SELLER_DELEGATED_VALID_TOKEN"),
  workloadToken: required("MCP_SELLER_BACKEND_WORKLOAD_TOKEN"),
  cloudRunIdToken: optional("MCP_SELLER_CLOUD_RUN_ID_TOKEN"),
  backendCloudRunIdToken: optional("MCP_SELLER_BACKEND_CLOUD_RUN_ID_TOKEN"),
  ownedProductId: required("MCP_SELLER_OWNED_PRODUCT_ID"),
  foreignProductId: required("MCP_SELLER_FOREIGN_PRODUCT_ID"),
  ownedOrderId: required("MCP_SELLER_OWNED_ORDER_ID"),
  foreignOrderId: required("MCP_SELLER_FOREIGN_ORDER_ID"),
  sameGroupOrderId: required("MCP_SELLER_SAME_GROUP_ORDER_ID"),
  expectedProductQuantity: Number(required("MCP_SELLER_EXPECTED_PRODUCT_QUANTITY")),
  expectedOptionStock: Number(required("MCP_SELLER_EXPECTED_OPTION_STOCK")),
  expectedInventoryUnits: Number(required("MCP_SELLER_EXPECTED_INVENTORY_UNITS")),
  expectedRevenueSaleCount: Number(required("MCP_SELLER_EXPECTED_REVENUE_SALE_COUNT")),
  expectedRevenueGross: required("MCP_SELLER_EXPECTED_REVENUE_GROSS"),
  markers: JSON.parse(required("MCP_SELLER_FORBIDDEN_MARKERS")),
};
if (config.clientName !== "shopsphere-mcp-client") throw new Error("MCP_SELLER_CLIENT_NAME must be shopsphere-mcp-client");
if (!Array.isArray(config.markers) || config.markers.length === 0
  || config.markers.some((value) => typeof value !== "string" || !value)) {
  throw new Error("MCP_SELLER_FORBIDDEN_MARKERS must be a non-empty JSON string array");
}
for (const value of [config.expectedProductQuantity, config.expectedOptionStock,
  config.expectedInventoryUnits, config.expectedRevenueSaleCount]) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Expected seller counts must be nonnegative integers");
}
if (!/^\d{1,10}\.\d{2}$/.test(config.expectedRevenueGross)) throw new Error("Expected revenue gross must be a money amount");

const decode = (token, name) => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw new Error(`${name} must be a JWT`); }
};
const claims = decode(config.validToken, "MCP_SELLER_VALID_TOKEN");
if (claims.azp !== config.clientName || (claims.shopsphere_user_id ?? claims.sub) !== config.subject
  || (claims.shopsphere_role ?? claims.role) !== "seller"
  || ![true, "true"].includes(claims.shopsphere_verified)) {
  throw new Error("Valid token must belong to the approved verified seller and client");
}

if (mode === "enabled") {
  Object.assign(config, {
    unverified: required("MCP_SELLER_UNVERIFIED_TOKEN"),
    staleVerification: required("MCP_SELLER_STALE_VERIFICATION_TOKEN"),
    wrongRole: required("MCP_SELLER_WRONG_ROLE_TOKEN"),
    wrongScope: required("MCP_SELLER_WRONG_SCOPE_TOKEN"),
    revoked: required("MCP_SELLER_REVOKED_TOKEN"),
    missing: required("MCP_SELLER_MISSING_ACCOUNT_TOKEN"),
    unapproved: required("MCP_SELLER_UNAPPROVED_ACCOUNT_TOKEN"),
    delegatedUnverified: required("MCP_SELLER_DELEGATED_UNVERIFIED_TOKEN"),
    delegatedStaleVerification: required("MCP_SELLER_DELEGATED_STALE_VERIFICATION_TOKEN"),
    delegatedWrongRole: required("MCP_SELLER_DELEGATED_WRONG_ROLE_TOKEN"),
    delegatedWrongScope: required("MCP_SELLER_DELEGATED_WRONG_SCOPE_TOKEN"),
    delegatedRevoked: required("MCP_SELLER_DELEGATED_REVOKED_TOKEN"),
    delegatedMissing: required("MCP_SELLER_DELEGATED_MISSING_ACCOUNT_TOKEN"),
    delegatedUnapproved: required("MCP_SELLER_DELEGATED_UNAPPROVED_ACCOUNT_TOKEN"),
  });
  const unverified = decode(config.unverified, "MCP_SELLER_UNVERIFIED_TOKEN");
  const staleVerification = decode(config.staleVerification, "MCP_SELLER_STALE_VERIFICATION_TOKEN");
  const wrongScope = decode(config.wrongScope, "MCP_SELLER_WRONG_SCOPE_TOKEN");
  const wrongRole = decode(config.wrongRole, "MCP_SELLER_WRONG_ROLE_TOKEN");
  const unapproved = decode(config.unapproved, "MCP_SELLER_UNAPPROVED_ACCOUNT_TOKEN");
  const scopes = typeof wrongScope.scope === "string" ? wrongScope.scope.split(" ") : wrongScope.scopes ?? [];
  if (unverified.azp !== config.clientName
    || (unverified.shopsphere_user_id ?? unverified.sub) === config.subject
    || (unverified.shopsphere_role ?? unverified.role) !== "seller"
    || ![false, "false"].includes(unverified.shopsphere_verified)) {
    throw new Error("Unverified fixture must be a separate unverified seller on the approved client");
  }
  if (staleVerification.azp !== config.clientName
    || (staleVerification.shopsphere_user_id ?? staleVerification.sub)
      !== (unverified.shopsphere_user_id ?? unverified.sub)
    || (staleVerification.shopsphere_role ?? staleVerification.role) !== "seller"
    || ![true, "true"].includes(staleVerification.shopsphere_verified)) {
    throw new Error("Stale-verification fixture must claim verified for the live unverified seller");
  }
  if (wrongRole.azp !== config.clientName
    || (wrongRole.shopsphere_user_id ?? wrongRole.sub) !== config.subject
    || (wrongRole.shopsphere_role ?? wrongRole.role) === "seller") {
    throw new Error("Wrong-role fixture must carry a different role for the pilot seller");
  }
  if (wrongScope.azp !== config.clientName
    || (wrongScope.shopsphere_user_id ?? wrongScope.sub) !== config.subject
    || (wrongScope.shopsphere_role ?? wrongScope.role) !== "seller"
    || ![true, "true"].includes(wrongScope.shopsphere_verified)) {
    throw new Error("Wrong-scope fixture must be the verified pilot seller");
  }
  if (sellerToolDefinitions.some((tool) => tool.scopes.every((scope) => scopes.includes(scope)))) {
    throw new Error("Wrong-scope fixture can read a seller tool");
  }
  if (unapproved.azp !== config.clientName
    || (unapproved.shopsphere_user_id ?? unapproved.sub) === config.subject) {
    throw new Error("Unapproved fixture must use a separate account and the approved client");
  }
  const grants = [claims.sid, wrongScope.sid, wrongRole.sid, unverified.sid, staleVerification.sid];
  if (grants.some((grant) => typeof grant !== "string" || !grant) || new Set(grants).size !== grants.length) {
    throw new Error("Valid and denial fixtures need distinct short-lived grants");
  }
}

const inputs = {
  list_my_products: {},
  get_my_product: { productId: config.ownedProductId },
  get_my_inventory_summary: {},
  list_my_seller_orders: {},
  get_my_seller_order: { orderId: config.ownedOrderId },
  get_my_revenue_summary: {},
};
const evidence = {
  schemaVersion: "1.0.0", issue: 32, mode, disabledTool,
  startedAt: new Date().toISOString(),
  client: { id: config.clientName, version: config.clientVersion },
  tools: SELLER_TOOL_NAMES, checks: [],
};
const check = async (name, run) => {
  const started = Date.now();
  try {
    const detail = await run();
    evidence.checks.push({ name, outcome: "pass", durationMs: Date.now() - started, ...detail });
  } catch {
    evidence.checks.push({ name, outcome: "fail", durationMs: Date.now() - started, error: "validation_failed" });
    process.exitCode = 1;
    throw new Error(`Seller release gate stopped at ${name}`);
  }
};
const waitRateWindow = async (phase) => {
  if (rateWaitMs) await check(`rate_window_reset:${phase}`, async () => {
    await new Promise((resolve) => setTimeout(resolve, rateWaitMs));
    return { waitedMs: rateWaitMs };
  });
};
const headers = (token, cloudToken) => ({
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(cloudToken ? { "x-serverless-authorization": `Bearer ${cloudToken}` } : {}),
});
const connect = async (token) => {
  const client = new Client({ name: config.clientName, version: config.clientVersion },
    { versionNegotiation: { mode: "legacy" } });
  await client.connect(new StreamableHTTPClientTransport(config.endpoint, {
    requestInit: { headers: headers(token, config.cloudRunIdToken) },
  }));
  return client;
};
const bounded = (value) => {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > DEFAULT_MAX_RESPONSE_BYTES || config.markers.some((marker) => serialized.includes(marker))
    || /postgres(?:ql)?:\/\/|client_secret|private_key|authorization\s*:/i.test(serialized)) {
    throw new Error("Private response exceeded bound or disclosed forbidden data");
  }
  return bytes;
};
const assertSellerFacts = (name, output) => {
  if (name === "list_my_products"
    && (!output.products?.some(({ id }) => id === config.ownedProductId)
      || output.products.some(({ id }) => id === config.foreignProductId))) {
    throw new Error("Owned catalog fixture missing or foreign product disclosed");
  }
  if (name === "get_my_product"
    && (output.id !== config.ownedProductId || output.quantity !== config.expectedProductQuantity
      || !output.options?.some(({ stock }) => stock === config.expectedOptionStock))) {
    throw new Error("Private product or option stock differs from fixture");
  }
  if (name === "get_my_inventory_summary" && output.totalUnits !== config.expectedInventoryUnits) {
    throw new Error("Inventory total differs from fixture");
  }
  if (name === "list_my_seller_orders"
    && (!output.sales?.some(({ id }) => id === config.ownedOrderId)
      || output.sales.some(({ id }) => id === config.foreignOrderId))) {
    throw new Error("Owned sale fixture missing or foreign sale disclosed");
  }
  if (name === "get_my_seller_order"
    && (output.sale?.id !== config.ownedOrderId
      || output.sale.productId !== config.foreignProductId
      || !output.groupSales?.some(({ id }) => id === config.sameGroupOrderId)
      || output.groupSales.some(({ id }) => id === config.foreignOrderId))) {
    throw new Error("Historical seller attribution or mixed-group isolation failed");
  }
  if (name === "get_my_revenue_summary"
    && (output.totals?.saleCount !== config.expectedRevenueSaleCount
      || output.totals?.grossSale?.amount !== config.expectedRevenueGross)) {
    throw new Error("Seller revenue differs from independent fixture");
  }
};
const mcpDenied = async (client, name, input, expected) => {
  try {
    const result = await client.callTool({ name, arguments: input });
    if (!result.isError) throw new Error("unexpected success");
    bounded(result);
    const message = result.content?.map(({ text }) => text ?? "").join(" ") ?? "";
    if (!expected.test(message)) throw new Error("unexpected MCP denial");
  } catch (error) {
    if (!expected.test(error.message)) throw error;
  }
};
const unavailableTool = /unknown tool|tool not found|not found/i;
const malformedInput = /invalid|unrecognized|unknown field|schema/i;
const foreignResource = /resource not found|not_found/i;
const backendCall = async (name, token, input = inputs[name]) => {
  const response = await fetch(new URL(`/api/v1/assistant/${name}`, config.backendUrl), {
    method: "POST", redirect: "error",
    headers: { ...headers(token, config.backendCloudRunIdToken),
      "x-assistant-api-token": config.workloadToken, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.text();
  const responseBytes = bounded(body);
  let code;
  try {
    const output = JSON.parse(body);
    code = output.code;
    if (response.status === 200) assertSellerFacts(name, output);
  } catch (error) {
    if (response.status === 200) throw error;
  }
  return { status: response.status, responseBytes, code };
};
const backendStatus = async (name, token, expected, input = inputs[name], expectedCode) => {
  const result = await backendCall(name, token, input);
  if (result.status !== expected || (expectedCode && result.code !== expectedCode)) {
    throw new Error("Unexpected backend denial");
  }
  return { status: result.status, responseBytes: result.responseBytes };
};
const rawInitialize = async (token) => fetch(config.endpoint, {
  method: "POST", redirect: "error",
  headers: { ...headers(token, config.cloudRunIdToken), accept: "application/json, text/event-stream", "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: config.clientName, version: config.clientVersion },
  } }),
});

let validClient;
try {
  if (mode === "disabled") {
    await check("mcp_disabled", async () => {
      const response = await rawInitialize(config.validToken);
      if (response.status === 503) return { globalSwitchDenied: true, responseBytes: bounded(await response.text()) };
      if (!response.ok) throw new Error("Unexpected initialize status");
      validClient = await connect(config.validToken);
      const names = (await validClient.listTools()).tools.map(({ name }) => name);
      if (SELLER_TOOL_NAMES.some((name) => names.includes(name))) throw new Error("Seller read disclosed");
      for (const name of SELLER_TOOL_NAMES) await mcpDenied(validClient, name, inputs[name], unavailableTool);
      return { deniedTools: SELLER_TOOL_NAMES.length };
    });
    await check("express_disabled", async () => {
      for (const name of SELLER_TOOL_NAMES) await backendStatus(name, config.delegatedValid, 404);
      return { deniedRoutes: SELLER_TOOL_NAMES.length };
    });
  } else {
    validClient = await connect(config.validToken);
    await check("mcp_discovery", async () => {
      const names = (await validClient.listTools()).tools.map(({ name }) => name);
      for (const name of SELLER_TOOL_NAMES) {
        if (names.includes(name) === (name === disabledTool)) throw new Error("Incorrect seller discovery");
      }
      return { visibleSellerReads: SELLER_TOOL_NAMES.length - Number(Boolean(disabledTool)) };
    });
    if (mode === "flag") {
      await check(`mcp_flag_denial:${disabledTool}`, async () => {
        await mcpDenied(validClient, disabledTool, inputs[disabledTool], unavailableTool);
        return { denied: true };
      });
      await check(`express_flag_denial:${disabledTool}`, () => backendStatus(disabledTool, config.delegatedValid, 404));
    } else {
      for (const name of SELLER_TOOL_NAMES) {
        await check(`mcp_call:${name}`, async () => {
          const result = await validClient.callTool({ name, arguments: inputs[name] });
          if (result.isError || !result.structuredContent) throw new Error("Seller read failed");
          assertSellerFacts(name, result.structuredContent);
          return { responseBytes: bounded(result) };
        });
        await check(`mcp_malformed:${name}`, async () => {
          await mcpDenied(validClient, name, { __unknown: true }, malformedInput);
          return { denied: true };
        });
      }
      await check("mcp_repeated_reads", async () => {
        for (const name of SELLER_TOOL_NAMES) {
          const result = await validClient.callTool({ name, arguments: inputs[name] });
          if (result.isError || !result.structuredContent) throw new Error("Repeated seller read failed");
          assertSellerFacts(name, result.structuredContent);
          bounded(result);
        }
        return { repeatedReads: SELLER_TOOL_NAMES.length };
      });
      await waitRateWindow("mcp_denials");
      for (const [scenario, token] of [["unverified_seller", config.unverified], ["wrong_role", config.wrongRole], ["wrong_scope", config.wrongScope]]) {
        await check(`mcp_denial:${scenario}`, async () => {
          let client;
          try {
            client = await connect(token);
            const names = (await client.listTools()).tools.map(({ name }) => name);
            if (SELLER_TOOL_NAMES.some((name) => names.includes(name))) throw new Error("Seller read discovered");
            for (const name of SELLER_TOOL_NAMES) await mcpDenied(client, name, inputs[name], unavailableTool);
            return { deniedTools: SELLER_TOOL_NAMES.length };
          } catch (error) {
            if (scenario === "unverified_seller") throw error;
            if (!/401|403|404|unauthorized|forbidden|denied|not found/i.test(error.message)) throw error;
            return { sessionDenied: true };
          } finally { await client?.close().catch(() => {}); }
        });
      }
      await check("mcp_denial:stale_verification", async () => {
        const response = await rawInitialize(config.staleVerification);
        if (response.status !== 403) throw new Error("Stale verification was not denied");
        return { status: response.status, responseBytes: bounded(await response.text()) };
      });
      for (const [scenario, token, status] of [["revoked", config.revoked, 401], ["missing_account", config.missing, 401],
        ["unapproved_account", config.unapproved, 403], ["unauthenticated", null, 401]]) {
        await check(`mcp_denial:${scenario}`, async () => {
          const response = await rawInitialize(token);
          if (response.status !== status) throw new Error("Identity not denied");
          return { status, responseBytes: bounded(await response.text()) };
        });
      }
      for (const [name, input] of [["get_my_product", { productId: config.foreignProductId }],
        ["get_my_seller_order", { orderId: config.foreignOrderId }]]) {
        await check(`mcp_foreign:${name}`, async () => { await mcpDenied(validClient, name, input, foreignResource); return { denied: true }; });
      }
      await waitRateWindow("express_matrix");
      await check("express_valid_seller", async () => {
        for (const name of SELLER_TOOL_NAMES) await backendStatus(name, config.delegatedValid, 200);
        return { successfulRoutes: SELLER_TOOL_NAMES.length };
      });
      await check("express_repeated_reads", async () => {
        for (const name of SELLER_TOOL_NAMES) await backendStatus(name, config.delegatedValid, 200);
        return { repeatedReads: SELLER_TOOL_NAMES.length };
      });
      await check("express_malformed", async () => {
        for (const name of SELLER_TOOL_NAMES) await backendStatus(name, config.delegatedValid, 400, { __unknown: true });
        return { deniedRoutes: SELLER_TOOL_NAMES.length };
      });
      for (const [scenario, token, status] of [["unverified_seller", config.delegatedUnverified, 403],
        ["stale_verification", config.delegatedStaleVerification, 403],
        ["wrong_role", config.delegatedWrongRole, 403], ["wrong_scope", config.delegatedWrongScope, 403],
        ["revoked", config.delegatedRevoked, 401], ["missing_account", config.delegatedMissing, 401]]) {
        await check(`express_denial:${scenario}`, async () => {
          for (const name of SELLER_TOOL_NAMES) {
            await backendStatus(name, token, status, inputs[name],
              scenario === "unverified_seller" ? "seller_not_verified"
                : scenario === "stale_verification" ? "stale_identity" : undefined);
          }
          return { deniedRoutes: SELLER_TOOL_NAMES.length };
        });
      }
      await waitRateWindow("express_cohort_denial");
      await check("express_denial:unapproved_account", async () => {
        for (const name of SELLER_TOOL_NAMES) await backendStatus(name, config.delegatedUnapproved, 403);
        return { deniedRoutes: SELLER_TOOL_NAMES.length };
      });
      for (const [name, input] of [["get_my_product", { productId: config.foreignProductId }],
        ["get_my_seller_order", { orderId: config.foreignOrderId }]]) {
        await check(`express_foreign:${name}`, () => backendStatus(name, config.delegatedValid, 404, input));
      }
      await check("express_unauthenticated", () => backendStatus(SELLER_TOOL_NAMES[0], null, 401));
    }
  }
} finally {
  await validClient?.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  const requiredChecks = mode === "disabled" ? ["mcp_disabled", "express_disabled"]
    : mode === "flag" ? ["mcp_discovery", `mcp_flag_denial:${disabledTool}`, `express_flag_denial:${disabledTool}`]
      : [
          "mcp_discovery",
          ...SELLER_TOOL_NAMES.flatMap((name) => [`mcp_call:${name}`, `mcp_malformed:${name}`]),
          "mcp_repeated_reads",
          ...["unverified_seller", "wrong_role", "wrong_scope", "stale_verification", "revoked",
            "unauthenticated", "missing_account", "unapproved_account"].map((scenario) => `mcp_denial:${scenario}`),
          "mcp_foreign:get_my_product", "mcp_foreign:get_my_seller_order",
          "express_valid_seller", "express_repeated_reads", "express_malformed",
          ...["unverified_seller", "stale_verification", "wrong_role", "wrong_scope", "revoked",
            "missing_account", "unapproved_account"].map((scenario) => `express_denial:${scenario}`),
          "express_foreign:get_my_product", "express_foreign:get_my_seller_order", "express_unauthenticated",
        ];
  const completed = new Set(evidence.checks.filter(({ outcome }) => outcome === "pass").map(({ name }) => name));
  evidence.outcome = evidence.checks.length > 0
    && evidence.checks.every(({ outcome }) => outcome === "pass")
    && requiredChecks.every((name) => completed.has(name)) ? "pass" : "fail";
  evidence.requiredCheckCount = requiredChecks.length;
  process.stdout.write(`SHOPSPHERE_SELLER_EVIDENCE=${JSON.stringify(evidence)}\n`);
  if (evidence.outcome !== "pass") process.exitCode = 1;
}
