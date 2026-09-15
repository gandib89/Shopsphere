import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantLimitStore } from "./assistantLimits.js";

test("distributed assistant limits cover subject, client, role, seller, IP, and platform without raw cache keys", async () => {
  const keys = [];
  const redis = {
    isReady: true,
    eval: async (_script, options) => { keys.push(options.keys[0]); return [1, 60_000]; },
  };
  const store = createAssistantLimitStore({ redis });
  assert.deepEqual(await store.consume({
    subject: "seller-secret-id",
    clientId: "client-secret-id",
    role: "seller",
    sellerId: "seller-secret-id",
    ip: "192.0.2.1",
  }), { allowed: true, retryAfterMs: 60_000 });
  assert.equal(keys.length, 6);
  assert.ok(keys.some((key) => key.includes(":subject-client:")));
  assert.ok(keys.some((key) => key.includes(":seller:")));
  assert.equal(keys.join(" ").includes("seller-secret-id"), false);
  assert.equal(keys.join(" ").includes("192.0.2.1"), false);
});

test("private assistant limits fail closed when Redis is unavailable", async () => {
  await assert.rejects(
    createAssistantLimitStore({ redis: { isReady: false } }).consume({ subject: "a" }),
    { statusCode: 503 },
  );
});
