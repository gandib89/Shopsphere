import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { BUYER_TOOL_NAMES, buyerToolDefinitions } from "../src/buyerReleaseGate.js";
import { DEFAULT_MAX_RESPONSE_BYTES } from "../src/toolRegistry.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optional = (name) => process.env[name] || null;
const mode = process.env.MCP_BUYER_MODE ?? "enabled";
if (!new Set(["enabled", "disabled"]).has(mode)) throw new Error("MCP_BUYER_MODE must be enabled or disabled");

const clientName = required("MCP_BUYER_CLIENT_NAME");
if (clientName !== "shopsphere-mcp-client") {
  throw new Error("MCP_BUYER_CLIENT_NAME must be shopsphere-mcp-client");
}

const config = {
  endpoint: new URL(required("MCP_BUYER_URL")),
  clientVersion: required("MCP_BUYER_CLIENT_VERSION"),
  cloudRunIdToken: optional("MCP_BUYER_CLOUD_RUN_ID_TOKEN"),
  validToken: required("MCP_BUYER_VALID_TOKEN"),
  accountSubject: required("MCP_BUYER_ACCOUNT_SUBJECT"),
  backendUrl: new URL(required("MCP_BUYER_BACKEND_URL")),
  backendWorkloadToken: required("MCP_BUYER_BACKEND_WORKLOAD_TOKEN"),
  backendCloudRunIdToken: optional("MCP_BUYER_BACKEND_CLOUD_RUN_ID_TOKEN"),
  delegatedValidToken: required("MCP_BUYER_DELEGATED_VALID_TOKEN"),
  orderId: required("MCP_BUYER_ORDER_ID"),
  foreignOrderId: required("MCP_BUYER_FOREIGN_ORDER_ID"),
  promoCode: required("MCP_BUYER_PROMO_CODE"),
  forbiddenMarkers: JSON.parse(required("MCP_BUYER_FORBIDDEN_MARKERS")),
};

const decodeJwtPayload = (token, name) => {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error(`${name} must be a JWT`);
  }
};

const validClaims = decodeJwtPayload(config.validToken, "MCP_BUYER_VALID_TOKEN");
if (validClaims.azp !== "shopsphere-mcp-client") {
  throw new Error("The valid pilot token was not issued to shopsphere-mcp-client");
}
if ((validClaims.shopsphere_user_id ?? validClaims.sub) !== config.accountSubject) {
  throw new Error("The valid pilot token does not belong to MCP_BUYER_ACCOUNT_SUBJECT");
}

if (!Array.isArray(config.forbiddenMarkers) || config.forbiddenMarkers.length === 0
  || config.forbiddenMarkers.some((value) => typeof value !== "string" || !value)) {
  throw new Error("MCP_BUYER_FORBIDDEN_MARKERS must be a non-empty JSON string array");
}

if (mode === "enabled") {
  Object.assign(config, {
    wrongRoleToken: required("MCP_BUYER_WRONG_ROLE_TOKEN"),
    wrongScopeToken: required("MCP_BUYER_WRONG_SCOPE_TOKEN"),
    revokedToken: required("MCP_BUYER_REVOKED_TOKEN"),
    missingAccountToken: required("MCP_BUYER_MISSING_ACCOUNT_TOKEN"),
    delegatedWrongRoleToken: required("MCP_BUYER_DELEGATED_WRONG_ROLE_TOKEN"),
    delegatedWrongScopeToken: required("MCP_BUYER_DELEGATED_WRONG_SCOPE_TOKEN"),
    delegatedRevokedToken: required("MCP_BUYER_DELEGATED_REVOKED_TOKEN"),
    delegatedMissingAccountToken: required("MCP_BUYER_DELEGATED_MISSING_ACCOUNT_TOKEN"),
  });

  const wrongRoleClaims = decodeJwtPayload(config.wrongRoleToken, "MCP_BUYER_WRONG_ROLE_TOKEN");
  const wrongRole = wrongRoleClaims.shopsphere_role ?? wrongRoleClaims.role;
  if (typeof wrongRole !== "string"
    || buyerToolDefinitions.some((definition) => definition.roles.includes(wrongRole))) {
    throw new Error("MCP_BUYER_WRONG_ROLE_TOKEN must carry a role rejected by every buyer tool");
  }

  const wrongScopeClaims = decodeJwtPayload(config.wrongScopeToken, "MCP_BUYER_WRONG_SCOPE_TOKEN");
  const wrongScopes = typeof wrongScopeClaims.scope === "string"
    ? wrongScopeClaims.scope.split(" ").filter(Boolean)
    : Array.isArray(wrongScopeClaims.scopes) ? wrongScopeClaims.scopes : [];
  if (buyerToolDefinitions.some((definition) => definition.scopes.every((scope) => wrongScopes.includes(scope)))) {
    throw new Error("MCP_BUYER_WRONG_SCOPE_TOKEN must lack the required scope for every buyer tool");
  }

  const scenarioGrantIds = [validClaims.sid, wrongRoleClaims.sid, wrongScopeClaims.sid];
  if (scenarioGrantIds.some((grantId) => typeof grantId !== "string" || !grantId)
    || new Set(scenarioGrantIds).size !== scenarioGrantIds.length) {
    throw new Error("Valid, wrong-role, and wrong-scope MCP tokens must use distinct short-lived grants");
  }
}

const evidence = {
  schemaVersion: "1.0.0",
  issue: 31,
  mode,
  startedAt: new Date().toISOString(),
  client: { id: clientName, version: config.clientVersion },
  tools: BUYER_TOOL_NAMES,
  checks: [],
};

const check = async (name, run) => {
  const startedAt = Date.now();
  try {
    const detail = await run();
    evidence.checks.push({ name, outcome: "pass", durationMs: Date.now() - startedAt, ...detail });
  } catch {
    evidence.checks.push({ name, outcome: "fail", durationMs: Date.now() - startedAt, error: "validation_failed" });
    process.exitCode = 1;
    throw new Error(`Buyer release gate stopped at ${name}`);
  }
};

const headersFor = (token, cloudRunIdToken) => ({
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(cloudRunIdToken ? { "x-serverless-authorization": `Bearer ${cloudRunIdToken}` } : {}),
});

const createClient = async (token) => {
  const client = new Client(
    { name: clientName, version: config.clientVersion },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(config.endpoint, {
    requestInit: { headers: headersFor(token, config.cloudRunIdToken) },
  }));
  return client;
};

const toolInputs = Object.freeze({
  get_my_profile_summary: {},
  list_my_notifications: { limit: 1 },
  get_my_cart: {},
  validate_promo_code: { code: config.promoCode },
  preview_checkout: {},
  list_my_orders: {},
  get_my_order: { orderId: config.orderId },
  track_my_order: { orderId: config.orderId },
  get_my_bill_summary: { orderId: config.orderId },
  get_my_payment_status: { orderId: config.orderId },
});

const assertSanitizedAndBounded = (value) => {
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > DEFAULT_MAX_RESPONSE_BYTES) throw new Error("response too large");
  if (config.forbiddenMarkers.some((marker) => serialized.includes(marker))) {
    throw new Error("forbidden marker disclosed");
  }
  if (/postgres(?:ql)?:\/\/|client_secret|private_key|authorization\s*:/i.test(serialized)) {
    throw new Error("credential or dependency detail disclosed");
  }
  return bytes;
};

const responseEvidence = async (response) => ({
  status: response.status,
  responseBytes: assertSanitizedAndBounded(await response.text()),
});

const expectMcpDenial = async (client, tool, args) => {
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    if (!result.isError) throw new Error("unexpected success");
    assertSanitizedAndBounded(result);
  } catch (error) {
    if (error?.message === "unexpected success") throw error;
    if (!/401|403|404|unauthorized|forbidden|authorization|verification|not found|unknown|denied|revoked/i.test(error?.message ?? "")) {
      throw error;
    }
  }
};

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: clientName, version: config.clientVersion },
  },
});

const rawInitialize = (token) => fetch(config.endpoint, {
  method: "POST",
  redirect: "error",
  headers: {
    ...headersFor(token, config.cloudRunIdToken),
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: initializeBody,
});

const backendCall = async (path, token, body = {}) => {
  const response = await fetch(new URL(`/api/v1/assistant/${path}`, config.backendUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      ...headersFor(token, config.backendCloudRunIdToken),
      "x-assistant-api-token": config.backendWorkloadToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, bytes: Buffer.byteLength(text), text };
};

const expectBackendDenial = async (path, token, body, statuses) => {
  const result = await backendCall(path, token, body);
  if (!statuses.includes(result.status)) throw new Error("unexpected backend status");
  assertSanitizedAndBounded(result.text);
  return { status: result.status, responseBytes: result.bytes };
};

let validClient;
try {
  if (mode === "disabled") {
    await check("mcp_disabled_discovery", async () => {
      const initialize = await rawInitialize(config.validToken);
      if (initialize.status === 503) {
        return { globalSwitchDenied: true, ...await responseEvidence(initialize) };
      }
      if (!initialize.ok) throw new Error("unexpected disabled initialize status");
      validClient = await createClient(config.validToken);
      const discovered = (await validClient.listTools()).tools.map(({ name }) => name);
      if (BUYER_TOOL_NAMES.some((name) => discovered.includes(name))) throw new Error("buyer tool discovered");
      for (const name of BUYER_TOOL_NAMES) await expectMcpDenial(validClient, name, toolInputs[name]);
      return { hiddenTools: BUYER_TOOL_NAMES.length };
    });
    await check("express_disabled_routes", async () => {
      for (const definition of buyerToolDefinitions) {
        const result = await expectBackendDenial(
          definition.name,
          config.delegatedValidToken,
          toolInputs[definition.name],
          [404],
        );
        if (result.status !== 404) throw new Error("route not disabled");
      }
      return { deniedRoutes: BUYER_TOOL_NAMES.length };
    });
  } else {
    validClient = await createClient(config.validToken);
    await check("mcp_enabled_discovery", async () => {
      const discovered = (await validClient.listTools()).tools.map(({ name }) => name);
      const missing = BUYER_TOOL_NAMES.filter((name) => !discovered.includes(name));
      if (missing.length) throw new Error("buyer discovery incomplete");
      const forbidden = discovered.filter((name) => /seller|platform|application|draft|propose|queue|promotion/i.test(name));
      if (forbidden.length) throw new Error("non-buyer private tool discovered");
      return { buyerToolCount: BUYER_TOOL_NAMES.length };
    });

    for (const name of BUYER_TOOL_NAMES) {
      await check(`mcp_call:${name}`, async () => {
        const result = await validClient.callTool({ name, arguments: toolInputs[name] });
        if (result.isError || !result.structuredContent) throw new Error("tool failed");
        return { responseBytes: assertSanitizedAndBounded(result) };
      });
      await check(`mcp_malformed:${name}`, async () => {
        await expectMcpDenial(validClient, name, { __unknown: true });
        return { denied: true };
      });
    }

    await check("mcp_repeated_reads", async () => {
      for (const name of BUYER_TOOL_NAMES) {
        const result = await validClient.callTool({ name, arguments: toolInputs[name] });
        if (result.isError || !result.structuredContent) throw new Error("repeated tool read failed");
        assertSanitizedAndBounded(result);
      }
      return { repeatedReads: BUYER_TOOL_NAMES.length };
    });

    for (const [scenario, token] of [
      ["wrong_role", config.wrongRoleToken],
      ["wrong_scope", config.wrongScopeToken],
    ]) {
      await check(`mcp_denial:${scenario}`, async () => {
        const client = await createClient(token);
        try {
          const discovered = (await client.listTools()).tools.map(({ name }) => name);
          if (BUYER_TOOL_NAMES.some((name) => discovered.includes(name))) throw new Error("buyer tool disclosed");
          for (const name of BUYER_TOOL_NAMES) await expectMcpDenial(client, name, toolInputs[name]);
        } finally {
          await client.close().catch(() => {});
        }
        return { denied: true, deniedTools: BUYER_TOOL_NAMES.length };
      });
    }

    await check("mcp_denial:revoked", async () => {
      const response = await rawInitialize(config.revokedToken);
      if (response.status !== 401) throw new Error("revoked token was not denied");
      return { denied: true, ...await responseEvidence(response) };
    });

    for (const [scenario, token] of [
      ["unauthenticated", null],
      ["missing_account", config.missingAccountToken],
    ]) {
      await check(`mcp_denial:${scenario}`, async () => {
        const response = await rawInitialize(token);
        if (response.status !== 401) throw new Error("identity was not denied");
        return { denied: true, ...await responseEvidence(response) };
      });
    }

    await check("mcp_foreign_buyer", async () => {
      for (const name of ["get_my_order", "track_my_order", "get_my_bill_summary", "get_my_payment_status"]) {
        await expectMcpDenial(validClient, name, { orderId: config.foreignOrderId });
      }
      return { deniedTools: 4 };
    });

    await check("express_valid_buyer", async () => {
      for (const definition of buyerToolDefinitions) {
        const result = await backendCall(definition.name, config.delegatedValidToken, toolInputs[definition.name]);
        if (result.status !== 200) throw new Error("backend buyer call failed");
        assertSanitizedAndBounded(result.text);
      }
      return { successfulRoutes: BUYER_TOOL_NAMES.length };
    });

    await check("express_repeated_reads", async () => {
      for (const definition of buyerToolDefinitions) {
        const result = await backendCall(definition.name, config.delegatedValidToken, toolInputs[definition.name]);
        if (result.status !== 200) throw new Error("repeated backend read failed");
        assertSanitizedAndBounded(result.text);
      }
      return { repeatedReads: BUYER_TOOL_NAMES.length };
    });

    await check("express_malformed_inputs", async () => {
      for (const definition of buyerToolDefinitions) {
        await expectBackendDenial(definition.name, config.delegatedValidToken, { __unknown: true }, [400]);
      }
      return { deniedRoutes: BUYER_TOOL_NAMES.length };
    });

    for (const [scenario, token, statuses] of [
      ["wrong_role", config.delegatedWrongRoleToken, [403]],
      ["wrong_scope", config.delegatedWrongScopeToken, [403]],
      ["revoked", config.delegatedRevokedToken, [401]],
      ["missing_account", config.delegatedMissingAccountToken, [401]],
    ]) {
      await check(`express_denial:${scenario}`, async () => {
        for (const name of BUYER_TOOL_NAMES) await expectBackendDenial(name, token, toolInputs[name], statuses);
        return { deniedRoutes: BUYER_TOOL_NAMES.length };
      });
    }

    await check("express_missing_auth", async () => {
      const response = await fetch(new URL("/api/v1/assistant/get_my_cart", config.backendUrl), {
        method: "POST",
        headers: {
          ...(config.backendCloudRunIdToken ? { "x-serverless-authorization": `Bearer ${config.backendCloudRunIdToken}` } : {}),
          "x-assistant-api-token": config.backendWorkloadToken,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (response.status !== 401) throw new Error("missing auth accepted");
      return responseEvidence(response);
    });

    await check("express_foreign_buyer", async () => {
      for (const name of ["get_my_order", "track_my_order", "get_my_bill_summary", "get_my_payment_status"]) {
        await expectBackendDenial(name, config.delegatedValidToken, { orderId: config.foreignOrderId }, [404]);
      }
      return { deniedRoutes: 4 };
    });
  }
} finally {
  await validClient?.close().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  evidence.outcome = evidence.checks.length > 0 && evidence.checks.every(({ outcome }) => outcome === "pass")
    ? "pass"
    : "fail";
  process.stdout.write(`SHOPSPHERE_BUYER_EVIDENCE=${JSON.stringify(evidence)}\n`);
  if (evidence.outcome !== "pass") process.exitCode = 1;
}
