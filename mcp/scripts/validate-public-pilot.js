import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { PROTOCOL_VERSION } from "../src/toolRegistry.js";

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
    const sanitizedError = String(error.message).split(token).join("[REDACTED]");
    evidence.checks.push({ name, outcome: "fail", durationMs: Date.now() - startedAt, error: sanitizedError });
    throw error;
  }
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
    const missing = expectedTools.filter((name) => !listed.includes(name));
    if (missing.length) throw new Error(`Missing public tools: ${missing.join(", ")}`);
    return { tools: listed };
  });

  await check("get_capabilities", async () => {
    const result = await client.callTool({ name: "get_capabilities", arguments: {} });
    return { responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
  });
  await check("get_store_policy", async () => {
    const result = await client.callTool({ name: "get_store_policy", arguments: { topic: "returns" } });
    return { responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
  });
  const search = await check("search_products", async () => {
    const result = await client.callTool({ name: "search_products", arguments: { limit: 2 } });
    const productIds = result.structuredContent?.items?.map(({ id }) => id) ?? [];
    if (!productIds.length) throw new Error("The staging fixture must include at least one published product");
    return { responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8"), productIds };
  });
  const productId = search.productIds[0];
  await check("compare_products", async () => {
    const result = await client.callTool({ name: "compare_products", arguments: { productIds: search.productIds } });
    return { responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
  });
  for (const name of ["get_product", "get_product_reviews", "get_recommendations"]) {
    await check(name, async () => {
      const result = await client.callTool({ name, arguments: { productId } });
      return { responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
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
