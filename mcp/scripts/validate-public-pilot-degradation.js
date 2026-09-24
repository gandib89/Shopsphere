import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = process.env.MCP_PILOT_URL;
const token = process.env.MCP_PILOT_ACCESS_TOKEN;
const cloudRunIdToken = process.env.MCP_PILOT_CLOUD_RUN_ID_TOKEN;
const backendOrigin = process.env.MCP_PILOT_BACKEND_ORIGIN;
const frontendOrigin = process.env.MCP_PILOT_FRONTEND_ORIGIN;

if (!endpoint || !token || !cloudRunIdToken || !backendOrigin || !frontendOrigin) {
  throw new Error("Pilot credentials plus backend and frontend origins are required");
}

const client = new Client(
  { name: "shopsphere-stage-degradation-gate", version: "2026-09-24" },
  { versionNegotiation: { mode: "legacy" } },
);
const evidence = { schemaVersion: "1.0.0", startedAt: new Date().toISOString() };
let stage = "connect";

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`,
        "x-serverless-authorization": `Bearer ${cloudRunIdToken}`,
      },
    },
  }));
  stage = "tool_error";
  const result = await client.callTool({ name: "search_products", arguments: { q: "synthetic" } });
  const serialized = JSON.stringify(result);
  if (!result.isError || Buffer.byteLength(serialized) >= 4096
    || /https?:\/\/|postgresql|secret|credential|internal|database/i.test(serialized)) {
    throw new Error("degraded tool response was not bounded and sanitized");
  }

  stage = "health_paths";
  const mcpHealth = await fetch(new URL("/health", endpoint), {
    headers: { "x-serverless-authorization": `Bearer ${cloudRunIdToken}` },
  });
  const backendHealth = await fetch(new URL("/health", backendOrigin), {
    headers: { authorization: `Bearer ${cloudRunIdToken}` },
  });
  const frontend = await fetch(frontendOrigin, {
    headers: { authorization: `Bearer ${cloudRunIdToken}` },
  });
  if (mcpHealth.status !== 200 || backendHealth.status !== 200 || frontend.status !== 200) {
    throw new Error("independent health path failed");
  }
  Object.assign(evidence, {
    outcome: "pass",
    toolErrorBytes: Buffer.byteLength(serialized),
    mcpHealthStatus: mcpHealth.status,
    storefrontBackendHealthStatus: backendHealth.status,
    storefrontStatus: frontend.status,
  });
} catch {
  evidence.outcome = "fail";
  evidence.failureStage = stage;
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  await client.close().catch(() => {});
}
