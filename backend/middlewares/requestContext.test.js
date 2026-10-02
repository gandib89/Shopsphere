import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { requestContext } from "./requestContext.js";
import { createAssistantParserErrorHandler } from "./assistantParserError.js";

const canary = "private-request-log-canary";
const request = (server, path, body) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: "127.0.0.1", port: server.address().port,
    path, method: "POST", headers: { "content-type": "application/json", "x-request-id": "public-trace",
      "content-length": Buffer.byteLength(body) },
  }, (res) => {
    res.resume();
    res.on("end", () => resolve({ status: res.statusCode, trace: res.headers["x-request-id"], assistantRoute: res.headers["x-test-assistant-route"] }));
  });
  req.on("error", reject);
  req.end(body);
});

const setup = async (t) => {
  const events = [];
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  t.after(() => { console.log = originalLog; console.error = originalError; });
  const app = express();
  app.use(requestContext);
  app.use("/api/v1/assistant", express.json({ limit: "32kb" }));
  app.use("/api/v1/assistant", createAssistantParserErrorHandler(async (event) => events.push(event)));
  app.use("/api/v1/assistant", (_req, res) => res.set("x-test-assistant-route", "true").json({ accepted: true }));
  app.use((_req, res) => res.json({ accepted: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { server, events, logs };
};

test("real assistant parser failures log a stable path without query, suffix, or body text", async (t) => {
  const { server, events, logs } = await setup(t);
  const paths = [
    `/api/v1/assistant/draft_support_message?notes=${canary}`,
    `/api/v1/assistant/${canary}`,
    `/api/v1/assistant?notes=${encodeURIComponent(canary)}`,
    `/API/V1/Assistant/${canary}?notes=${canary}`,
  ];
  for (const path of paths) {
    const response = await request(server, path, `{"purpose":"${canary}"`);
    assert.equal(response.status, 400);
    assert.equal(response.trace, "public-trace");
  }
  const oversized = await request(server, paths[0], JSON.stringify({ notes: canary }).padEnd(32 * 1024 + 1, " "));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.trace, "public-trace");
  assert.equal(events.length, 5);
  assert.equal(logs.length, 5);
  for (const log of logs) {
    const entry = JSON.parse(log);
    assert.equal(entry.message, "request");
    assert.equal(entry.requestId, "public-trace");
    assert.equal(entry.path, "/api/v1/assistant");
    assert.ok([400, 413].includes(entry.statusCode));
  }
  assert.equal(JSON.stringify({ logs, events }).includes(canary), false);
});

test("successful assistant requests also omit caller query and path text from completion logs", async (t) => {
  const { server, logs } = await setup(t);
  const response = await request(server, `/api/v1/assistant/${canary}?notes=${canary}`, "{}");
  assert.equal(response.status, 200);
  assert.equal(response.trace, "public-trace");
  assert.equal(JSON.parse(logs[0]).path, "/api/v1/assistant");
  assert.equal(JSON.stringify(logs).includes(canary), false);
});

test("ordinary routes and similar prefixes retain their existing original URL logging", async (t) => {
  const { server, logs } = await setup(t);
  const paths = [`/ordinary?notes=${canary}`, `/api/v1/assistant-other/${canary}`];
  for (const path of paths) assert.equal((await request(server, path, "{}")).status, 200);
  assert.deepEqual(logs.map((log) => JSON.parse(log).path), paths);
});

test("log classification matches actual case-insensitive Express routes without decoding encoded prefixes", async (t) => {
  const { server, logs } = await setup(t);
  const uppercase = await request(server, `/API/V1/Assistant/${canary}`, "{}");
  assert.equal(uppercase.assistantRoute, "true");
  assert.equal(JSON.parse(logs[0]).path, "/api/v1/assistant");
  const encodedPath = `/api/v1/%61ssistant/${canary}`;
  const encoded = await request(server, encodedPath, "{}");
  assert.equal(encoded.assistantRoute, undefined);
  assert.equal(JSON.parse(logs[1]).path, encodedPath);
});
