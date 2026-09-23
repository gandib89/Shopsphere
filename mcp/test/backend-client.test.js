import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";

test("private backend calls use workload authentication plus exchanged delegation", async () => {
  const requests = [];
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    cloudRunIdToken: async () => "google-id-token",
    exchangeToken: async (subjectToken, scopes) => {
      assert.equal(subjectToken, "mcp-subject-token");
      assert.deepEqual(scopes, ["profile:read"]);
      return "delegated-token";
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ displayName: "Ada Buyer", role: "user", verified: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const output = await client.call("get_my_profile_summary", {}, { subjectToken: "mcp-subject-token" });
  assert.equal(output.displayName, "Ada Buyer");
  assert.equal(requests[0].init.headers.authorization, "Bearer delegated-token");
  assert.equal(requests[0].init.headers["x-assistant-api-token"], "workload-secret");
  assert.equal(requests[0].init.headers["x-serverless-authorization"], "Bearer google-id-token");
});

test("authorization context is resolved through a fresh exchanged token", async () => {
  let exchanges = 0;
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    cloudRunIdToken: async () => "google-id-token",
    exchangeToken: async () => { exchanges += 1; return "delegated-token"; },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /authorization-context$/);
      assert.equal(init.headers.authorization, "Bearer delegated-token");
      assert.equal(init.headers["x-serverless-authorization"], "Bearer google-id-token");
      return new Response(JSON.stringify({ subject: "user-1", role: "seller", verified: true, scopes: ["profile:read"], grantId: "grant-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const resolved = await client.resolveAuthorization({
    subjectToken: "mcp-token",
    auth: { sub: "user-1", role: "user", scopes: ["profile:read"] },
  });
  assert.equal(exchanges, 1);
  assert.equal(resolved.auth.role, "seller");
});

test("MCP audit events are sent only to the fixed workload-authenticated audit operation", async () => {
  let request;
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    cloudRunIdToken: async () => "google-id-token",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(null, { status: 204 });
    },
  });
  await client.recordAudit({ operation: "notifications.listMine", authorizationOutcome: "allowed", outcome: "success", latencyMs: 4 }, { requestId: "trace-1" });
  assert.match(request.url, /\/api\/v1\/assistant\/audit$/);
  assert.equal(request.init.headers["x-assistant-api-token"], "workload-secret");
  assert.equal(request.init.headers["x-request-id"], "trace-1");
  assert.equal(request.init.headers.authorization, undefined);
  assert.equal(request.init.headers["x-serverless-authorization"], "Bearer google-id-token");
});

test("local backend calls do not request a Cloud Run identity token", async () => {
  const client = createBackendClient({
    origin: "http://backend:4000",
    token: "workload-secret",
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers["x-serverless-authorization"], undefined);
      return new Response("{}", { status: 200 });
    },
  });
  await client.call("search_products", {});
});
