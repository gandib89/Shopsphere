import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import { requestContext } from "./requestContext.js";
import { createAssistantParserErrorHandler } from "./assistantParserError.js";

const limit = 32 * 1024;
const canary = "private-parser-body-canary";
const rawRequest = (server, body, { path = "/api/v1/assistant/test", contentType = "application/json", chunked = false, trace = "parser-trace" } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port: server.address().port, path, method: "POST",
      headers: { "content-type": contentType, "x-request-id": trace,
        ...(chunked ? {} : { "content-length": Buffer.byteLength(body) }) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    if (chunked) { req.write(body.slice(0, limit)); req.end(body.slice(limit)); }
    else req.end(body);
  });

const setup = async (t, recordAudit) => {
  const app = express();
  app.use(requestContext);
  app.use("/api/v1/assistant", express.json({ limit: "32kb" }), express.urlencoded({ extended: true, limit: "32kb" }));
  app.use("/api/v1/assistant", createAssistantParserErrorHandler(recordAudit));
  app.use(express.json());
  app.post(["/api/v1/assistant/test", "/ordinary"], (_req, res) => res.json({ accepted: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ordinaryError: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return server;
};

test("application assigns context before parsers and isolates assistant parser errors", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const context = source.indexOf("app.use(requestContext)");
  const parser = source.indexOf("express.json({ limit: '32kb' })");
  const handler = source.indexOf("app.use('/api/v1/assistant', assistantParserErrorHandler)");
  assert.ok(context >= 0 && context < parser && parser < handler && handler < source.indexOf("app.use(express.json())"));
});

test("unrelated errors pass through without an assistant parser audit", async () => {
  const error = Object.assign(Error(canary), { type: "unrelated.error", body: canary });
  let forwarded;
  let writes = 0;
  await createAssistantParserErrorHandler(async () => { writes += 1; })(error, {}, {}, (nextError) => { forwarded = nextError; });
  assert.equal(forwarded, error);
  assert.equal(writes, 0);
});

test("actual JSON parser accepts exactly 32 KiB and audits both oversized ingress paths without body data", async (t) => {
  const events = [];
  const server = await setup(t, async (event) => events.push(event));
  const json = JSON.stringify({ purpose: canary });
  const exact = json.padEnd(limit, " ");
  assert.equal(Buffer.byteLength(exact), limit);
  assert.equal((await rawRequest(server, exact)).status, 200);
  assert.equal(events.length, 0);
  for (const chunked of [false, true]) {
    const response = await rawRequest(server, exact + " ", { chunked });
    assert.equal(response.status, 413);
    assert.equal(response.headers["x-request-id"], "parser-trace");
    assert.equal(JSON.parse(response.text).code, "request_too_large");
    assert.ok(Buffer.byteLength(response.text) < 300);
    assert.equal(response.text.includes(canary), false);
  }
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.traceId, "parser-trace");
    assert.equal(event.operation, "transport.request");
    assert.equal(event.outcome, "request_rejected");
    assert.equal(event.failureReason, "request_too_large");
    assert.equal(event.authorizationOutcome, "denied");
    assert.deepEqual(event.input, {});
  }
  assert.equal(JSON.stringify(events).includes(canary), false);
});

test("malformed JSON is traced and audited with stable metadata and no parser message or body", async (t) => {
  const events = [];
  const server = await setup(t, async (event) => events.push(event));
  const response = await rawRequest(server, `{"purpose":"${canary}"`);
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.text), {
    success: false, code: "invalid_json", message: "Invalid JSON request body", requestId: "parser-trace",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].failureReason, "invalid_json");
  assert.deepEqual(events[0].input, {});
  assert.equal(JSON.stringify(events).includes(canary), false);
});

for (const body of ["{" + canary, "{}".padEnd(limit + 1, " ")]) {
  test(`parser rejection fails closed when audit persistence fails (${body.length > limit ? "size" : "JSON"})`, async (t) => {
    const server = await setup(t, async () => { throw Error(canary); });
    const response = await rawRequest(server, body);
    assert.equal(response.status, 503);
    assert.equal(response.headers["x-request-id"], "parser-trace");
    assert.equal(JSON.parse(response.text).code, "audit_unavailable");
    assert.equal(response.text.includes(canary), false);
  });
}

test("ordinary routes retain the default JSON limit and parser error handling", async (t) => {
  const events = [];
  const server = await setup(t, async (event) => events.push(event));
  assert.equal((await rawRequest(server, "{}".padEnd(40 * 1024, " "), { path: "/ordinary" })).status, 200);
  const invalid = await rawRequest(server, "{", { path: "/ordinary" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(JSON.parse(invalid.text), { ordinaryError: true });
  assert.deepEqual(events, []);
});

test("assistant URL-encoded oversized bodies use the same safe audit classification", async (t) => {
  const events = [];
  const server = await setup(t, async (event) => events.push(event));
  const response = await rawRequest(server, `purpose=${canary}`.padEnd(limit + 1, "x"), { contentType: "application/x-www-form-urlencoded" });
  assert.equal(response.status, 413);
  assert.equal(events[0].failureReason, "request_too_large");
  assert.equal(JSON.stringify(events).includes(canary), false);
});
