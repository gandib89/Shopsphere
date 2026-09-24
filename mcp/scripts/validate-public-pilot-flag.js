import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = process.env.MCP_PILOT_URL;
const token = process.env.MCP_PILOT_ACCESS_TOKEN;
const cloudRunIdToken = process.env.MCP_PILOT_CLOUD_RUN_ID_TOKEN;
const disabledTool = process.env.MCP_PILOT_DISABLED_TOOL;

const argumentsByTool = {
  get_capabilities: {},
  get_store_policy: { topic: "returns" },
  search_products: {},
  compare_products: { productIds: ["synthetic-product"] },
  get_product: { productId: "synthetic-product" },
  get_product_reviews: { productId: "synthetic-product" },
  get_recommendations: { productId: "synthetic-product" },
};

if (!endpoint || !token || !cloudRunIdToken || !(disabledTool in argumentsByTool)) {
  throw new Error("Pilot endpoint credentials and a known disabled tool are required");
}

const client = new Client(
  { name: "shopsphere-stage-flag-gate", version: "2026-09-24" },
  { versionNegotiation: { mode: "legacy" } },
);
const evidence = { schemaVersion: "1.0.0", disabledTool, startedAt: new Date().toISOString() };

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`,
        "x-serverless-authorization": `Bearer ${cloudRunIdToken}`,
      },
    },
  }));
  const tools = (await client.listTools()).tools.map(({ name }) => name);
  if (tools.includes(disabledTool)) throw new Error("disabled tool remained discoverable");
  try {
    const result = await client.callTool({ name: disabledTool, arguments: argumentsByTool[disabledTool] });
    if (!result.isError) throw new Error("forged dispatch succeeded");
  } catch (error) {
    if (error?.message === "forged dispatch succeeded") throw error;
  }
  Object.assign(evidence, { outcome: "pass", discoveredToolCount: tools.length, forgedDispatchDenied: true });
} catch {
  evidence.outcome = "fail";
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  await client.close().catch(() => {});
}
