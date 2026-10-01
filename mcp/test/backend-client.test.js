import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { createMcpHttpServer } from "../src/httpServer.js";
import { close, listen } from "./support/httpServer.js";

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

const authorizationContext = { subjectToken: "synthetic-token", auth: { scopes: ["platform:read"] } };
const authorizationClient = (fetchImpl) => createBackendClient({
  origin: "http://backend:4000", token: "synthetic-workload", exchangeToken: async () => "synthetic-delegated", fetchImpl,
});

for (const failure of [new TypeError("private upstream connection detail"), new DOMException("private timeout detail", "TimeoutError")]) {
  test(`authorization upstream ${failure.name} remains a sanitized dependency failure`, async () => {
    const client = authorizationClient(async () => { throw failure; });
    await assert.rejects(client.resolveAuthorization(authorizationContext), (error) =>
      error.statusCode === 503 && error.message === "Delegated authorization dependency unavailable" && !error.cause);
  });
}

test("malformed successful authorization response is a dependency failure", async () => {
  const client = authorizationClient(async () => new Response("invalid-json", { status: 200 }));
  await assert.rejects(client.resolveAuthorization(authorizationContext), { statusCode: 503 });
});

for (const status of [401, 403, 404, 503]) {
  test(`authorization backend HTTP ${status} preserves its status`, async () => {
    const client = authorizationClient(async () => new Response(null, { status }));
    await assert.rejects(client.resolveAuthorization(authorizationContext), { statusCode: status, message: "Delegated authorization failed" });
  });
}

for (const failure of [new TypeError("private connection detail"), new DOMException("private deadline detail", "TimeoutError")]) {
  test(`HTTP authorization ${failure.name} records dependency denial with a correlated bounded response`, async (t) => {
    const events = [];
    const client = authorizationClient(async (url, init) => {
      if (String(url).endsWith("/audit")) { events.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
      throw failure;
    });
    const accessToken = "synthetic-access-token-with-at-least-32-characters";
    const server = createMcpHttpServer({ enabled: true, accessToken, backendClient: client,
      authContextResolver: () => client.resolveAuthorization(authorizationContext) });
    const url = await listen(server); t.after(() => close(server));
    const response = await fetch(url, { method: "POST", headers: {
      authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-request-id": "dependency-trace",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-request-id"), "dependency-trace");
    assert.deepEqual(await response.json(), { error: "OAuth issuer unavailable" });
    assert.equal(events.length, 1);
    assert.equal(events[0].traceId, "dependency-trace");
    assert.equal(events[0].operation, "authorization.resolve");
    assert.equal(events[0].outcome, "dependency_unavailable");
    assert.equal(events[0].failureReason, "issuer_or_grant_unavailable");
    assert.equal(JSON.stringify(events).includes("private"), false);
  });
}
