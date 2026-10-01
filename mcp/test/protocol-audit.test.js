import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpServer } from "../src/httpServer.js";
import { ACCESS_TOKEN, ALL_FLAGS, fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const request = (url, method, params, trace) => fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${ACCESS_TOKEN}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-11-25", "x-request-id": trace },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});

for (const flags of [ALL_FLAGS, {}]) {
  test(`discovery and forged dispatch persist actual protocol outcomes (${Object.keys(flags).length} flags)`, async (t) => {
    const events = [];
    const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags,
      backendClient: { ...fakeBackendClient, recordAudit: async (event) => events.push(event) } });
    const url = await listen(server); t.after(() => close(server));
    const discovery = await request(url, "tools/list", {}, "discovery-trace");
    assert.equal(discovery.status, 200);
    const event = events.find((e) => e.operation === "transport.discovery");
    assert.equal(event.traceId, "discovery-trace");
    assert.equal(event.outcome, Object.keys(flags).length ? "success" : "denied");
    assert.ok(event.responseBytes > 0); assert.match(event.responseDigest, /^[A-Za-z0-9_-]{43}$/);
    const canary = "secret-private-unregistered-tool";
    const forged = await request(url, "tools/call", { name: canary, arguments: { purpose: canary } }, "forged-trace");
    assert.equal(forged.status, 200);
    const denial = events.find((e) => e.operation === "transport.dispatch");
    assert.equal(denial.traceId, "forged-trace"); assert.equal(denial.outcome, "denied");
    assert.equal(denial.failureReason, "protocol_error"); assert.equal(denial.tool, null);
    assert.equal(JSON.stringify(events).includes(canary), false);
  });
}
for (const method of ["tools/list", "tools/call"]) {
  test(`${method} fails closed when protocol audit persistence fails`, async (t) => {
    const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags: ALL_FLAGS,
      backendClient: { ...fakeBackendClient, recordAudit: async () => { throw Error("private database fault"); } } });
    const url = await listen(server); t.after(() => close(server));
    const response = await request(url, method, method === "tools/list" ? {} : { name: "unknown", arguments: {} }, "audit-fault");
    assert.equal(response.status, 503); assert.equal(response.headers.get("x-request-id"), "audit-fault");
    assert.deepEqual(await response.json(), { error: "Audit service unavailable" });
  });
}

test("registered dispatch records its final error outcome when the backend fails but audit works", async (t) => {
  const events = [];
  const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags: ALL_FLAGS,
    backendClient: { ...fakeBackendClient, call: async () => { throw Object.assign(Error("private fault"), { statusCode: 503 }); }, recordAudit: async (event) => events.push(event) } });
  const url = await listen(server); t.after(() => close(server));
  const response = await request(url, "tools/call", { name: "search_products", arguments: { q: "item" } }, "registered-fault");
  assert.equal(response.status, 200);
  const event = events.find((e) => e.operation === "transport.dispatch");
  assert.equal(event.tool, "search_products"); assert.equal(event.outcome, "denied");
  assert.equal(event.failureReason, "tool_error"); assert.ok(event.latencyMs >= 0);
});

test("discovery protocol audit retains resolved identity and grant metadata", async (t) => {
  const events = [];
  const auth = { sub: "synthetic-account", role: "admin", clientId: "approved-client", grantId: "temporary-grant", scopes: [] };
  const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags: ALL_FLAGS,
    authContextResolver: async () => ({ auth }),
    backendClient: { ...fakeBackendClient, recordAudit: async (event) => events.push(event) } });
  const url = await listen(server); t.after(() => close(server));
  const response = await request(url, "tools/list", {}, "resolved-discovery");
  assert.equal(response.status, 200);
  const event = events.find((e) => e.operation === "transport.discovery");
  assert.equal(event.subjectId, auth.sub); assert.equal(event.role, auth.role);
  assert.equal(event.clientId, auth.clientId); assert.equal(event.grantId, auth.grantId);
  assert.equal(event.traceId, "resolved-discovery"); assert.ok(event.policyVersion);
});

test("registered successful dispatch fails closed if only its final protocol audit fails", async (t) => {
  const events = [];
  const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags: ALL_FLAGS,
    backendClient: { ...fakeBackendClient, recordAudit: async (event) => {
      events.push(event); if (event.operation === "transport.dispatch") throw Error("private audit fault");
    } } });
  const url = await listen(server); t.after(() => close(server));
  const response = await request(url, "tools/call", { name: "search_products", arguments: { q: "item" } }, "final-audit-fault");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Audit service unavailable" });
  assert.ok(events.some((e) => e.operation === "catalog.searchProducts" && e.outcome === "success"));
  assert.ok(events.some((e) => e.operation === "transport.dispatch" && e.outcome === "success"));
});
