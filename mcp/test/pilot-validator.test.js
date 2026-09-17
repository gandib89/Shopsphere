import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMcpHttpServer } from "../src/httpServer.js";
import { ACCESS_TOKEN, ALL_FLAGS, fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const runValidator = (url) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/validate-public-pilot.js", import.meta.url))], {
    env: {
      ...process.env,
      MCP_PILOT_URL: String(url),
      MCP_PILOT_ACCESS_TOKEN: ACCESS_TOKEN,
      MCP_PILOT_CLIENT_NAME: "shopsphere-pilot-test",
      MCP_PILOT_CLIENT_VERSION: "1.0.0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.resume();
  child.on("error", reject);
  child.on("close", (code) => {
    try {
      resolve({ code, evidence: JSON.parse(output) });
    } catch (error) {
      reject(new Error(`Pilot validator produced invalid evidence: ${error.message}`));
    }
  });
});

test("pilot validator records seven successful bounded public calls without product IDs", async (t) => {
  const server = createMcpHttpServer({
    accessToken: ACCESS_TOKEN,
    enabled: true,
    backendClient: fakeBackendClient,
    flags: ALL_FLAGS,
  });
  const url = await listen(server);
  t.after(() => close(server));

  const { code, evidence } = await runValidator(url);
  assert.equal(code, 0);
  assert.equal(evidence.outcome, "pass");
  assert.equal(evidence.checks.length, 9);
  assert.ok(evidence.checks.every(({ outcome }) => outcome === "pass"));
  assert.ok(evidence.checks.slice(2).every(({ responseBytes }) => responseBytes > 0 && responseBytes <= 64 * 1024));
  assert.equal(evidence.checks.find(({ name }) => name === "search_products").productCount > 0, true);
  assert.doesNotMatch(JSON.stringify(evidence), /productIds|access_token/i);
});

test("pilot validator fails when a public tool returns an error", async (t) => {
  const server = createMcpHttpServer({
    accessToken: ACCESS_TOKEN,
    enabled: true,
    flags: ALL_FLAGS,
    backendClient: {
      call(name, input, context) {
        if (name === "search_products") throw new Error("private backend address");
        return fakeBackendClient.call(name, input, context);
      },
    },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const { code, evidence } = await runValidator(url);
  assert.equal(code, 1);
  assert.equal(evidence.outcome, "fail");
  assert.equal(evidence.checks.at(-1).name, "search_products");
  assert.equal(evidence.checks.at(-1).outcome, "fail");
  assert.equal(evidence.checks.at(-1).error, "validation_failed");
  assert.doesNotMatch(JSON.stringify(evidence), /private backend address/i);
});

test("pilot validator fails when discovery omits a public tool", async (t) => {
  const server = createMcpHttpServer({
    accessToken: ACCESS_TOKEN,
    enabled: true,
    backendClient: fakeBackendClient,
    flags: { ...ALL_FLAGS, MCP_TOOL_GET_STORE_POLICY_ENABLED: false },
  });
  const url = await listen(server);
  t.after(() => close(server));

  const { code, evidence } = await runValidator(url);
  assert.equal(code, 1);
  assert.equal(evidence.outcome, "fail");
  assert.equal(evidence.checks.at(-1).name, "discovery");
  assert.equal(evidence.checks.at(-1).error, "validation_failed");
});
