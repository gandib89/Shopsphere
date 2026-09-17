import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { PROTOCOL_VERSION, REGISTRY_VERSION } from "../src/toolRegistry.js";

const endpoint = process.env.MCP_PILOT_URL;
const token = process.env.MCP_PILOT_ACCESS_TOKEN;
const clientName = process.env.MCP_PILOT_CLIENT_NAME;
const clientVersion = process.env.MCP_PILOT_CLIENT_VERSION;

if (!endpoint || !token || !clientName || !clientVersion) {
  throw new Error(
    "MCP_PILOT_URL, MCP_PILOT_ACCESS_TOKEN, MCP_PILOT_CLIENT_NAME, and MCP_PILOT_CLIENT_VERSION are required",
  );
}

const expectedTools = [
  "get_capabilities",
  "get_store_policy",
  "search_products",
  "compare_products",
  "get_product",
  "get_product_reviews",
  "get_recommendations",
];
const MAX_RESPONSE_BYTES = 64 * 1024;

const client = new Client(
  { name: clientName, version: clientVersion },
  { versionNegotiation: { mode: "legacy" } },
);
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
const evidence = {
  schemaVersion: "1.0.0",
  startedAt: new Date().toISOString(),
  endpointOrigin: new URL(endpoint).origin,
  client: { name: clientName, version: clientVersion },
  expectedProtocolVersion: PROTOCOL_VERSION,
  checks: [],
};

const check = async (name, run) => {
  const startedAt = Date.now();
  try {
    const result = await run();
    evidence.checks.push({ name, outcome: "pass", durationMs: Date.now() - startedAt, ...result });
    return result;
  } catch (error) {
    // SDK errors may contain a remote response body. Keep the evidence safe to share.
    evidence.checks.push({ name, outcome: "fail", durationMs: Date.now() - startedAt, error: "validation_failed" });
    throw error;
  }
};

const callPublicTool = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  const responseBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (result.isError || !result.structuredContent || responseBytes > MAX_RESPONSE_BYTES) {
    throw new Error(`Public tool validation failed: ${name}`);
  }
  return { result, responseBytes };
};

try {
  await check("initialize", async () => {
    await client.connect(transport);
    const negotiatedProtocolVersion = client.getNegotiatedProtocolVersion();
    if (negotiatedProtocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Negotiated ${negotiatedProtocolVersion}; expected ${PROTOCOL_VERSION}`);
    }
    return { negotiatedProtocolVersion };
  });

  await check("discovery", async () => {
    const listed = (await client.listTools()).tools.map(({ name }) => name);
    if (listed.length !== expectedTools.length || expectedTools.some((name) => !listed.includes(name))) {
      throw new Error("Public tool discovery mismatch");
    }
    return { tools: listed };
  });

  await check("get_capabilities", async () => {
    const { result, responseBytes } = await callPublicTool("get_capabilities", {});
    if (result.structuredContent.registryVersion !== REGISTRY_VERSION
      || result.structuredContent.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error("Pilot contract version mismatch");
    }
    return { responseBytes, registryVersion: REGISTRY_VERSION };
  });
  await check("get_store_policy", async () => {
    const { responseBytes } = await callPublicTool("get_store_policy", { topic: "returns" });
    return { responseBytes };
  });
  let productIds;
  await check("search_products", async () => {
    const { result, responseBytes } = await callPublicTool("search_products", { limit: 2 });
    productIds = result.structuredContent.items?.map(({ id }) => id) ?? [];
    if (!productIds.length) throw new Error("The staging fixture must include at least one published product");
    return { responseBytes, productCount: productIds.length };
  });
  const productId = productIds[0];
  await check("compare_products", async () => {
    const { responseBytes } = await callPublicTool("compare_products", { productIds });
    return { responseBytes };
  });
  for (const name of ["get_product", "get_product_reviews", "get_recommendations"]) {
    await check(name, async () => {
      const { responseBytes } = await callPublicTool(name, { productId });
      return { responseBytes };
    });
  }
} catch {
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.outcome = evidence.checks.every(({ outcome }) => outcome === "pass") ? "pass" : "fail";
  // The token and response content are deliberately excluded from this evidence artifact.
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  await client.close().catch(() => {});
}
