import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../src/backendClient.js";
import { readConfig } from "../src/config.js";
import { POLICY_VERSION, isToolAvailable, toolRegistry } from "../src/toolRegistry.js";

const tool = toolRegistry.find((candidate) => candidate.name === "draft_support_message");
const orderId = "a1b2c3d4e5f6a7b8c9d0e1f2";
const citation = { sourceId: "faqs.json#2", sourceVersion: POLICY_VERSION };
const validOutput = {
  orderId,
  topic: "delivery_issue",
  draft: "Hello ShopSphere support team,\n\nI need help with an order I placed on ShopSphere.",
  truncated: false,
  citations: [citation],
  generatedAt: "2026-09-18T10:00:00.000Z",
};

test("draft_support_message is a user-only draft tool with draft rate class", () => {
  assert.ok(tool, "tool is registered");
  assert.deepEqual([...tool.roles], ["user"]);
  assert.deepEqual([...tool.scopes], ["support:draft"]);
  assert.equal(tool.operationClass, "draft");
  assert.equal(tool.rateClass, "draft");
  assert.equal(tool.rollout.flag, "MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED");
  assert.equal(tool.rollout.defaultEnabled, false);
  assert.equal(tool.backendOperation.kind, "http");
  assert.equal(tool.backendOperation.operationId, "support.draftMessage");
  assert.equal(tool.backendOperation.method, "POST");
  assert.equal(tool.backendOperation.path, "/api/v1/assistant/draft_support_message");
});

test("draft_support_message ships dark and needs the consented support:draft scope", () => {
  const config = readConfig({});
  assert.equal(config.flags.MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED, false);
  assert.equal(isToolAvailable(tool, config.flags), false);
  const enabled = { MCP_TOOL_DRAFT_SUPPORT_MESSAGE_ENABLED: true };
  assert.equal(isToolAvailable(tool, enabled, { role: "user", scopes: ["support:draft"] }), true);
  assert.equal(isToolAvailable(tool, enabled, { role: "user", scopes: [] }), false);
  assert.equal(isToolAvailable(tool, enabled, { role: "seller", scopes: ["support:draft"] }), false);
  assert.equal(isToolAvailable(tool, enabled, { role: "admin", scopes: ["support:draft"] }), false);
});

test("draft input rejects recipients, send flags, and unknown or oversized fields", () => {
  assert.ok(tool.inputSchema.safeParse({ orderId, topic: "other" }).success);
  assert.ok(tool.inputSchema.safeParse({ orderId, topic: "order_status", notes: "It arrived late." }).success);
  for (const topic of ["order_status", "delivery_issue", "return_question", "refund_question", "other"]) {
    assert.ok(tool.inputSchema.safeParse({ orderId, topic }).success, topic);
  }
  // No recipient selection, no send/submit affordance, no arbitrary fields.
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", recipient: "support@x.com" }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", send: true }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", submit: true }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", channel: "email" }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", ticketId: "t-1" }).success);
  // Only bounded topics, bounded ids, and bounded notes exist.
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "complaints" }).success);
  assert.ok(tool.inputSchema.safeParse({ orderId: "short", topic: "other" }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId: "has space", topic: "other" }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId: "x".repeat(25), topic: "other" }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId: "x".repeat(24), topic: "other", notes: "x".repeat(501) }).success);
  assert.ok(!tool.inputSchema.safeParse({ orderId, topic: "other", notes: "" }).success);
  assert.ok(!tool.inputSchema.safeParse({ topic: "other" }).success);
});

test("draft output bounds the draft to 4000 characters and requires citations", () => {
  assert.ok(tool.outputSchema.safeParse(validOutput).success);
  assert.ok(tool.outputSchema.safeParse({ ...validOutput, citations: [] }).success);
  assert.ok(tool.outputSchema.safeParse({ ...validOutput, truncated: true, draft: "x".repeat(4000) }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, draft: "x".repeat(4001) }).success);
  // citations is a required field (empty only when no approved source exists).
  const { citations, ...withoutCitations } = validOutput;
  assert.ok(!tool.outputSchema.safeParse(withoutCitations).success);
  // Citation ids are versioned and pinned to the policy version.
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, citations: [{ sourceId: "faqs.json#2", sourceVersion: "9.9.9" }] }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, citations: [{ sourceId: "faqs.json#2" }] }).success);
  // No recipient, channel, send affordance, or ticket id exists in the output.
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, recipient: "support@x.com" }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, ticketId: "t-1" }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, send: true }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, topic: "complaints" }).success);
  assert.ok(!tool.outputSchema.safeParse({ ...validOutput, generatedAt: "2026-09-18 10:00" }).success);
});

test("draft_support_message exchanges the delegated token for support:draft only", async () => {
  let exchangedScopes;
  const calls = [];
  const client = createBackendClient({
    origin: "https://backend.internal",
    token: "workload-token",
    exchangeToken: async (_subjectToken, scopes) => {
      exchangedScopes = scopes;
      return "delegated-token";
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return new Response(JSON.stringify(validOutput), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const output = await client.call("draft_support_message", { orderId, topic: "other" }, { subjectToken: "subject-token", requestId: "req-1" });
  assert.deepEqual(exchangedScopes, ["support:draft"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/v1/assistant/draft_support_message"));
  assert.equal(calls[0].headers.authorization, "Bearer delegated-token");
  assert.equal(calls[0].headers["x-assistant-api-token"], "workload-token");
  assert.deepEqual(output, validOutput);
});
