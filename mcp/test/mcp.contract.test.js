import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer as createRawMcpHttpServer } from "../src/httpServer.js";
import { ACCESS_TOKEN, ALL_FLAGS, fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const PROTOCOL_VERSION = "2025-11-25";
const createMcpHttpServer = (options = {}) =>
  createRawMcpHttpServer({
    accessToken: ACCESS_TOKEN,
    backendClient: fakeBackendClient,
    ...options,
    flags: { ...ALL_FLAGS, ...options.flags },
  });

const connect = async (url) => {
  const client = new Client(
    { name: "shopsphere-contract-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } },
    }),
  );
  return client;
};

test("negotiates the pinned protocol and serves public get_capabilities", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  assert.equal(client.getNegotiatedProtocolVersion(), PROTOCOL_VERSION);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), [
    "get_capabilities",
    "get_store_policy",
    "search_products",
    "compare_products",
    "get_product",
    "get_product_reviews",
    "get_recommendations",
  ]);

  const result = await client.callTool({ name: "get_capabilities", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.protocolVersion, PROTOCOL_VERSION);
  assert.equal(result.structuredContent.registryVersion, "1.4.0");
  assert.deepEqual(result.structuredContent.tools, [
    {
      name: "get_capabilities",
      description: "Lists the ShopSphere MCP capabilities currently available to this caller and their policy metadata.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "discovery",
      rollout: {
        flag: "MCP_TOOL_GET_CAPABILITIES_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "local",
        operationId: "registry.getCapabilities",
        method: null,
        path: null,
      },
    },
    {
      name: "get_store_policy",
      description:
        "Answers approved ShopSphere store policy questions from versioned curated sources.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_GET_STORE_POLICY_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "policy.getStorePolicy",
        method: "POST",
        path: "/api/v1/assistant/get_store_policy",
      },
    },
    {
      name: "search_products",
      description: "Searches visible public products by text, category, and price with capped pages.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_SEARCH_PRODUCTS_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "catalog.searchProducts",
        method: "POST",
        path: "/api/v1/assistant/search_products",
      },
    },
    {
      name: "compare_products",
      description: "Compares up to 5 visible public products using the same public projection.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_COMPARE_PRODUCTS_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "catalog.compareProducts",
        method: "POST",
        path: "/api/v1/assistant/compare_products",
      },
    },
    {
      name: "get_product",
      description: "Inspects one visible public product: variants, displayed price, and availability label.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_GET_PRODUCT_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "catalog.getProduct",
        method: "POST",
        path: "/api/v1/assistant/get_product",
      },
    },
    {
      name: "get_product_reviews",
      description: "Reads bounded display-safe reviews for one visible public product; content is untrusted.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_GET_PRODUCT_REVIEWS_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "catalog.getProductReviews",
        method: "POST",
        path: "/api/v1/assistant/get_product_reviews",
      },
    },
    {
      name: "get_recommendations",
      description: "Lists currently available public products related to one visible product.",
      operationClass: "read",
      roles: ["public"],
      scopes: [],
      rateClass: "public-read",
      rollout: {
        flag: "MCP_TOOL_GET_RECOMMENDATIONS_ENABLED",
        enabled: true,
      },
      backendOperation: {
        kind: "http",
        operationId: "catalog.getRecommendations",
        method: "POST",
        path: "/api/v1/assistant/get_recommendations",
      },
    },
  ]);
});

test("accepts the protocol version used by Codex CLI 0.150.1", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-cli", version: "0.150.1" },
      },
    }),
  });

  assert.equal(response.status, 200);
  const responseText = await response.text();
  const payload = JSON.parse(
    responseText.startsWith("event:")
      ? responseText.split("\n").find((line) => line.startsWith("data: ")).slice(6)
      : responseText,
  );
  assert.equal(payload.result.protocolVersion, "2025-06-18");
});

test("rejects protocol revisions outside the supported allowlist", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "wrong-version", version: "1.0.0" },
      },
    }),
  });

  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /2025-11-25/);
});

test("private discovery and calls enforce live grant scope, role, verification, and rollout", async (t) => {
  let liveVerification = true;
  const auth = {
    sub: "user-1",
    role: "user",
    verified: true,
    clientId: "shopsphere-mcp-client",
    grantId: "grant-1",
    scopes: ["profile:read"],
  };
  const server = createMcpHttpServer({
    enabled: true,
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => {
      if (!liveVerification) throw Object.assign(new Error("Verification changed"), { statusCode: 403 });
      return { ...context, auth: { ...auth }, delegatedToken: "delegated-token" };
    },
  });
  const url = await listen(server);
  t.after(() => close(server));
  const client = await connect(url);
  t.after(() => client.close());

  assert.ok((await client.listTools()).tools.some(({ name }) => name === "get_my_profile_summary"));
  const result = await client.callTool({ name: "get_my_profile_summary", arguments: {} });
  assert.deepEqual(result.structuredContent, { displayName: "Ada Buyer", role: "user", verified: true });

  liveVerification = false;
  await assert.rejects(
    client.callTool({ name: "get_my_profile_summary", arguments: {} }),
    /401|403|unauthorized|forbidden|authorization|verification/i,
  );
});

test("a missing private scope hides the tool and forged calls are independently denied", async (t) => {
  const auth = { sub: "user-1", role: "user", verified: true, clientId: "shopsphere-mcp-client", grantId: "grant-1", scopes: [] };
  const server = createMcpHttpServer({
    enabled: true,
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth, delegatedToken: "delegated-token" }),
  });
  const url = await listen(server);
  t.after(() => close(server));
  const client = await connect(url);
  t.after(() => client.close());

  assert.equal((await client.listTools()).tools.some(({ name }) => name === "get_my_profile_summary"), false);
  await assert.rejects(
    client.callTool({ name: "get_my_profile_summary", arguments: {} }),
    /get_my_profile_summary|not found|unknown/i,
  );
});

test("list_my_notifications is private, bounded, and exposed only with its live scope", async (t) => {
  const auth = {
    sub: "user-1",
    role: "user",
    verified: true,
    clientId: "shopsphere-mcp-client",
    grantId: "grant-1",
    scopes: ["notifications:read"],
  };
  const server = createMcpHttpServer({
    enabled: true,
    tokenVerifier: async () => auth,
    authContextResolver: async (context) => ({ ...context, auth }),
  });
  const url = await listen(server);
  t.after(() => close(server));
  const client = await connect(url);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.equal(tools.tools.some(({ name }) => name === "get_my_profile_summary"), false);
  assert.equal(tools.tools.some(({ name }) => name === "list_my_notifications"), true);
  const result = await client.callTool({ name: "list_my_notifications", arguments: { limit: 20 } });
  assert.equal(result.structuredContent.notifications.length, 1);
  assert.deepEqual(Object.keys(result.structuredContent.notifications[0]), [
    "id", "type", "title", "message", "read", "productId", "productName", "createdAt",
  ]);
});

test("rejects unauthenticated requests before protocol handling", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(response.status, 401);
});

test("allows only exact configured browser Origins", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    allowedOrigins: ["https://shop.example"],
  });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "content-type": "application/json",
      origin: "https://shop.example.attacker.test",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "origin-test", version: "1.0.0" },
      },
    }),
  });

  assert.equal(response.status, 403);

  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: {
      origin: "https://shop.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,mcp-protocol-version",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://shop.example");
  assert.match(preflight.headers.get("access-control-allow-headers"), /mcp-protocol-version/i);
});

test("transport sessions are bounded to the subject, client, role, and grant", async (t) => {
  const sessions = new Map();
  let sequence = 0;
  const fingerprint = (auth) => JSON.stringify([auth.sub, auth.clientId, auth.role, auth.grantId]);
  const sessionStore = {
    async create(auth) { const id = `opaque-${++sequence}`; sessions.set(id, fingerprint(auth)); return id; },
    async validate(id, auth) { return sessions.get(id) === fingerprint(auth); },
    async destroy(id) { sessions.delete(id); },
  };
  const identities = {
    "token-a": { sub: "user-a", clientId: "client-1", role: "user", grantId: "grant-a", scopes: [] },
    "token-b": { sub: "user-b", clientId: "client-1", role: "user", grantId: "grant-b", scopes: [] },
  };
  const server = createMcpHttpServer({
    enabled: true,
    tokenVerifier: async (token) => identities[token],
    authContextResolver: async (context) => context,
    sessionStore,
  });
  const url = await listen(server);
  t.after(() => close(server));
  const initialize = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer token-a", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "session-test", version: "1" } } }),
  });
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);

  const foreign = await fetch(url, {
    method: "POST",
    headers: {
      authorization: "Bearer token-b",
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), { error: "Session not found" });
});

test("distributed limit dependency failure denies work before protocol dispatch", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    distributedControls: { enter: async () => { throw new Error("redis unavailable"); } },
  });
  const url = await listen(server);
  t.after(() => close(server));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "limit-test", version: "1" } } }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Distributed limit state unavailable" });
});

test("rejects request bodies over the configured contract limit", async (t) => {
  const server = createMcpHttpServer({ enabled: true, maxRequestBytes: 128 });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "x".repeat(256), version: "1.0.0" },
      },
    }),
  });

  assert.equal(response.status, 413);
});

test("stops oversized chunked bodies without relying on Content-Length", async (t) => {
  const server = createMcpHttpServer({ enabled: true, maxRequestBytes: 64 });
  const url = await listen(server);
  t.after(() => close(server));
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
      controller.enqueue(new TextEncoder().encode(`"payload":"${"x".repeat(128)}"}`));
      controller.close();
    },
  });
  const response = await fetch(url, {
    method: "POST",
    duplex: "half",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body,
  });
  assert.equal(response.status, 413);
});

test("rejects unknown tools and unknown get_capabilities fields", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  await assert.rejects(
    client.callTool({ name: "not_registered", arguments: {} }),
    /not_registered|not found|unknown/i,
  );

  const result = await client.callTool({
    name: "get_capabilities",
    arguments: { includeSecrets: true },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unrecognized|unknown|invalid/i);
});

test("returns a bounded error instead of an oversized tool response", async (t) => {
  const maxResponseBytes = 128;
  const server = createMcpHttpServer({ enabled: true, maxResponseBytes });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_capabilities", arguments: {} },
    }),
  });
  const responseBody = await response.text();

  assert.match(responseBody, /response limit/i);
  assert.ok(Buffer.byteLength(responseBody, "utf8") <= maxResponseBytes);
});

test("the global kill switch disables MCP without affecting storefront liveness", async (t) => {
  const mcpServer = createMcpHttpServer({ enabled: false });
  const mcpUrl = await listen(mcpServer);
  t.after(() => close(mcpServer));

  const { default: storefrontApp } = await import("../../backend/app.js");
  const storefrontServer = storefrontApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => storefrontServer.once("listening", resolve));
  t.after(() => close(storefrontServer));
  const storefrontAddress = storefrontServer.address();

  const disabledResponse = await fetch(mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "kill-switch-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(disabledResponse.status, 503);

  const storefrontResponse = await fetch(
    `http://127.0.0.1:${storefrontAddress.port}/health`,
  );
  assert.equal(storefrontResponse.status, 200);
  assert.deepEqual(await storefrontResponse.json(), { status: "ok" });
});

test("health reports the kill switch while the process stays live", async (t) => {
  const server = createMcpHttpServer({ enabled: false });
  const mcpUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(new URL("/health", mcpUrl));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", mcpEnabled: false });
});

test("the get_capabilities rollout flag removes discovery and dispatch", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    flags: { MCP_TOOL_GET_CAPABILITIES_ENABLED: false },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), [
    "get_store_policy",
    "search_products",
    "compare_products",
    "get_product",
    "get_product_reviews",
    "get_recommendations",
  ]);
  await assert.rejects(
    client.callTool({ name: "get_capabilities", arguments: {} }),
    /get_capabilities|not found|unknown/i,
  );
});
