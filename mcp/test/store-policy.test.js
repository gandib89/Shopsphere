import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMcpHttpServer } from "../src/httpServer.js";
import { POLICY_TOPICS, POLICY_VERSION, getStorePolicy } from "../src/policyContent.js";
import { DEFAULT_MAX_RESPONSE_BYTES } from "../src/toolRegistry.js";

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
    { name: "shopsphere-policy-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
};

test("allowlisted topics return versioned answers within response bounds", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  for (const topic of POLICY_TOPICS) {
    const result = await client.callTool({ name: "get_store_policy", arguments: { topic } });
    assert.equal(result.isError, undefined);
    const output = result.structuredContent;
    assert.equal(output.topic, topic);
    assert.ok(output.answer.length > 0);
    assert.ok(output.sourceId.length > 0);
    assert.equal(output.sourceVersion, POLICY_VERSION);
    assert.equal(output.registryVersion, "1.0.0");
    assert.ok(
      Buffer.byteLength(JSON.stringify(output), "utf8") <= DEFAULT_MAX_RESPONSE_BYTES,
    );
  }

  const returns = await client.callTool({
    name: "get_store_policy",
    arguments: { topic: "returns" },
  });
  assert.match(returns.structuredContent.answer, /7 days/);
});

test("unknown topics return an explicit unknown and never invent policy", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const result = await client.callTool({
    name: "get_store_policy",
    arguments: { topic: "refund-for-moon-landing" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unknown|invalid/i);
  assert.doesNotMatch(result.content[0].text, /7 days/);

  const direct = getStorePolicy("refund-for-moon-landing");
  assert.equal(direct.sourceId, "unknown");
  assert.equal(direct.sourceVersion, POLICY_VERSION);
  assert.match(direct.answer, /unknown/i);
});

test("unknown fields on get_store_policy are rejected", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const result = await client.callTool({
    name: "get_store_policy",
    arguments: { topic: "returns", url: "https://evil.test/policy" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unrecognized|unknown|invalid/i);
});

test("injection text in policy data cannot register tools", async (t) => {
  const server = createMcpHttpServer({ enabled: true });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const before = await client.listTools();
  assert.deepEqual(before.tools.map(({ name }) => name), [
    "get_capabilities",
    "get_store_policy",
  ]);

  for (const topic of POLICY_TOPICS) {
    const result = await client.callTool({
      name: "get_store_policy",
      arguments: { topic },
    });
    assert.equal(result.isError, undefined);
    assert.doesNotMatch(result.structuredContent.answer, /https?:\/\//);
  }

  const after = await client.listTools();
  assert.deepEqual(after.tools.map(({ name }) => name), [
    "get_capabilities",
    "get_store_policy",
  ]);
});

test("the get_store_policy rollout flag removes discovery and dispatch", async (t) => {
  const server = createMcpHttpServer({
    enabled: true,
    flags: { MCP_TOOL_GET_STORE_POLICY_ENABLED: false },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const client = await connect(url);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), ["get_capabilities"]);
  await assert.rejects(
    client.callTool({ name: "get_store_policy", arguments: { topic: "returns" } }),
    /get_store_policy|not found|unknown/i,
  );
});
