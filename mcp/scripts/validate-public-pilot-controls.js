const endpoint = process.env.MCP_PILOT_URL;
const token = process.env.MCP_PILOT_ACCESS_TOKEN;
const cloudRunIdToken = process.env.MCP_PILOT_CLOUD_RUN_ID_TOKEN;
const mode = process.env.MCP_PILOT_CONTROL_MODE;

if (!endpoint || !token || !cloudRunIdToken || !["rate", "concurrency", "load"].includes(mode)) {
  throw new Error("Pilot URL, access token, Cloud Run token, and a valid control mode are required");
}

let sequence = 0;
const initialize = async () => {
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": `pilot-${mode}-${++sequence}`,
      "x-serverless-authorization": `Bearer ${cloudRunIdToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: sequence,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: `shopsphere-stage-${mode}-gate`, version: "2026-09-24" },
      },
    }),
  });
  const body = await response.text();
  return {
    status: response.status,
    durationMs: Date.now() - startedAt,
    responseBytes: Buffer.byteLength(body),
    retryAfterPresent: Boolean(response.headers.get("retry-after")),
  };
};

const evidence = { schemaVersion: "1.0.0", mode, startedAt: new Date().toISOString() };
try {
  if (mode === "rate") {
    const results = [];
    for (let index = 0; index < 5; index += 1) results.push(await initialize());
    if (!results.some(({ status }) => status === 200)
      || !results.some(({ status, retryAfterPresent }) => status === 429 && retryAfterPresent)
      || results.some(({ responseBytes }) => responseBytes >= 1024)) {
      throw new Error("rate control did not produce bounded admission and denial");
    }
    Object.assign(evidence, {
      outcome: "pass",
      statuses: results.map(({ status }) => status),
      maxResponseBytes: Math.max(...results.map(({ responseBytes }) => responseBytes)),
    });
  } else if (mode === "concurrency") {
    const results = await Promise.all(Array.from({ length: 12 }, () => initialize()));
    if (!results.some(({ status }) => status === 200)
      || !results.some(({ status }) => status === 503)
      || results.some(({ responseBytes }) => responseBytes >= 64 * 1024)) {
      throw new Error("concurrency control did not produce bounded admission and denial");
    }
    Object.assign(evidence, {
      outcome: "pass",
      statuses: results.map(({ status }) => status),
      maxResponseBytes: Math.max(...results.map(({ responseBytes }) => responseBytes)),
    });
  } else {
    const results = [];
    for (let batch = 0; batch < 4; batch += 1) {
      results.push(...await Promise.all(Array.from({ length: 4 }, () => initialize())));
    }
    const durations = results.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
    const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
    if (results.some(({ status }) => status !== 200) || p95Ms > 3000) {
      throw new Error("approved load threshold failed");
    }
    Object.assign(evidence, {
      outcome: "pass",
      profile: "4 batches x 4 concurrent initialize requests",
      threshold: "0 errors and p95 <= 3000 ms",
      requests: results.length,
      p95Ms,
      maxResponseBytes: Math.max(...results.map(({ responseBytes }) => responseBytes)),
    });
  }
} catch {
  evidence.outcome = "fail";
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
