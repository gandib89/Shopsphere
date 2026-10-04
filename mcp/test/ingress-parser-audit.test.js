import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createMcpHttpServer } from "../src/httpServer.js";
import { createBackendClient } from "../src/backendClient.js";
import { remoteAuditInput } from "../../backend/routes/assistantRoute.js";
import { ACCESS_TOKEN, ALL_FLAGS, fakeBackendClient } from "./support/fakeBackend.js";
import { close, listen } from "./support/httpServer.js";

const limit = 32 * 1024;
const canary = "private-parser-body-canary";
const rawRequest = (url, body, { chunked = false } = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method: "POST", headers: {
    authorization: `Bearer ${ACCESS_TOKEN}`, accept: "application/json, text/event-stream",
    "content-type": "application/json", "mcp-protocol-version": "2025-11-25", "x-request-id": "parser-trace",
    ...(chunked ? {} : { "content-length": Buffer.byteLength(body) }),
  } }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject);
  if (chunked) { req.write(body.slice(0, limit)); req.end(body.slice(limit)); }
  else req.end(body);
});

const setup = async (t, recordAudit, options = {}) => {
  // Exercise the real wire serializer and production backend validator. A
  // permissive recordAudit fake previously accepted fields the endpoint rejects.
  const receiver = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const event = remoteAuditInput.safeParse(JSON.parse(Buffer.concat(chunks).toString()));
    if (!event.success) { res.writeHead(400); res.end(); return; }
    try { await recordAudit(event.data); res.writeHead(204); }
    catch { res.writeHead(503); }
    res.end();
  });
  const receiverUrl = await listen(receiver);
  t.after(() => close(receiver));
  const client = createBackendClient({ origin: receiverUrl.origin, token: "synthetic-workload" });
  const server = createMcpHttpServer({ enabled: true, accessToken: ACCESS_TOKEN, flags: ALL_FLAGS,
    maxRequestBytes: limit, backendClient: { ...fakeBackendClient, recordAudit: client.recordAudit }, ...options });
  const url = await listen(server);
  t.after(() => close(server));
  return url;
};

test("actual MCP parser accepts exactly 32 KiB and durably audits both oversized ingress paths", async (t) => {
  const events = [];
  const url = await setup(t, async (event) => events.push(event));
  const exact = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }).padEnd(limit, " ");
  assert.equal(Buffer.byteLength(exact), limit);
  assert.equal((await rawRequest(url, exact)).status, 200);
  assert.ok(events.some((event) => event.operation === "transport.discovery"));
  events.length = 0;
  for (const chunked of [false, true]) {
    const response = await rawRequest(url, JSON.stringify({ purpose: canary }).padEnd(limit + 1, " "), { chunked });
    assert.equal(response.status, 413);
    assert.equal(response.headers["x-request-id"], "parser-trace");
    assert.ok(Buffer.byteLength(response.text) < 300);
    assert.equal(response.text.includes(canary), false);
  }
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.traceId, "parser-trace");
    assert.equal(event.tool, null);
    assert.equal(event.operation, "transport.request");
    assert.equal(event.outcome, "request_rejected");
    assert.equal(event.authorizationOutcome, "denied");
    assert.equal(event.failureReason, "request_too_large");
    assert.equal(Object.hasOwn(event, "input"), false);
  }
  assert.equal(JSON.stringify(events).includes(canary), false);
});

test("malformed MCP JSON receives a traced durable audit without raw body or parse-error text", async (t) => {
  const events = [];
  const url = await setup(t, async (event) => events.push(event));
  const response = await rawRequest(url, `{"purpose":"${canary}"`);
  assert.equal(response.status, 400);
  assert.equal(response.headers["x-request-id"], "parser-trace");
  assert.deepEqual(JSON.parse(response.text), { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON" } });
  assert.equal(events.length, 1);
  assert.equal(events[0].failureReason, "invalid_json");
  assert.equal(events[0].operation, "transport.request");
  assert.equal(events[0].outcome, "request_rejected");
  assert.equal(Object.hasOwn(events[0], "input"), false);
  assert.equal(JSON.stringify(events).includes(canary), false);
});

test("the disabled kill switch persists its audit through the strict backend contract", async (t) => {
  const events = [];
  const url = await setup(t, async (event) => events.push(event), { enabled: false });
  const response = await rawRequest(url, "{}");
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.text), { error: "MCP is disabled" });
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, "transport.request");
  assert.equal(events[0].failureReason, "kill_switch");
  assert.equal(events[0].traceId, "parser-trace");
  assert.equal(Object.hasOwn(events[0], "input"), false);
});

for (const body of ["{" + canary, "{}".padEnd(limit + 1, " ")]) {
  test(`MCP parser rejection fails closed when audit persistence fails (${body.length > limit ? "size" : "JSON"})`, async (t) => {
    const url = await setup(t, async () => { throw Error(canary); });
    const response = await rawRequest(url, body);
    assert.equal(response.status, 503);
    assert.equal(response.headers["x-request-id"], "parser-trace");
    assert.deepEqual(JSON.parse(response.text), { error: "Audit service unavailable" });
    assert.equal(response.text.includes(canary), false);
  });
}
