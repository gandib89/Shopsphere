import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";

const PROTOCOL_VERSION = "2025-11-25";

const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
};

const close = async (server) => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const connect = async (url) => {
  const client = new Client(
    { name: "shopsphere-contract-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url));
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
  ]);

  const result = await client.callTool({ name: "get_capabilities", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.protocolVersion, PROTOCOL_VERSION);
  assert.equal(result.structuredContent.registryVersion, "1.0.0");
  assert.deepEqual(result.structuredContent.tools, [
    {
      name: "get_capabilities",
      description: "Lists the currently enabled public ShopSphere MCP capabilities and their policy metadata.",
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
        kind: "local",
        operationId: "registry.getStorePolicy",
        method: null,
        path: null,
      },
    },
  ]);
});

test("rejects protocol revisions other than the pinned version", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

test("rejects request bodies over the configured contract limit", async (t) => {
  const server = createMcpHttpServer({ enabled: true, maxRequestBytes: 128 });
  const url = await listen(server);
  t.after(() => close(server));

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    headers: { "content-type": "application/json" },
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
  assert.deepEqual(tools.tools.map(({ name }) => name), ["get_store_policy"]);
  await assert.rejects(
    client.callTool({ name: "get_capabilities", arguments: {} }),
    /get_capabilities|not found|unknown/i,
  );
});
