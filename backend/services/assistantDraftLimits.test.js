import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "redis";
import { consumeDraftLimit } from "./assistantDraftLimits.js";
import { createDraftLimit } from "./assistantDraftLimits.js";
import { createDraftSupportLimit } from "./assistantSupportDraftLimits.js";
import { createRecommendationLimit } from "./assistantRecommendationLimits.js";
import { enforceListingDraftLimit } from "./assistantListingDraftLimits.js";

const memoryRedis = () => {
  const counters = new Map();
  return { isReady: true, eval: async (_lua, { keys, arguments: args }) => {
    const count = (counters.get(keys[0]) ?? 0) + 1;
    counters.set(keys[0], count);
    return [count <= Number(args[1]) ? 1 : 0, 60_000];
  } };
};
const invoke = async (middleware, index) => {
  let status;
  let nexted = false;
  const res = { set() {}, status(code) { status = code; return this; }, json() {} };
  await middleware({ delegation: { sub: "subject-one", clientId: `client-${index}`, grantId: `grant-${index}`, role: index % 2 ? "seller" : "admin" } }, res, () => { nexted = true; });
  return { status, nexted };
};
test("draft families and rotated clients/grants share the subject minute ceiling", async () => {
  const redis = memoryRedis();
  const options = { redis, now: () => 86_400_000 };
  const families = [createDraftSupportLimit(options), enforceListingDraftLimit(options), createRecommendationLimit(options)];
  for (let i = 0; i < 10; i++) assert.equal((await invoke(families[i % 3], i)).nexted, true);
  for (let i = 10; i < 13; i++) assert.equal((await invoke(families[i % 3], i)).status, 429);
  assert.equal((await consumeDraftLimit(redis, { subject: "another-subject", now: options.now() })).allowed, true);
});
test("draft families share the daily ceiling across minute windows and client rotation", async () => {
  const redis = memoryRedis();
  let at = 86_400_000;
  const options = { redis, now: () => at };
  const families = [createDraftSupportLimit(options), enforceListingDraftLimit(options), createRecommendationLimit(options)];
  for (let i = 0; i < 100; i++) {
    at += 60_000;
    assert.equal((await invoke(families[i % 3], i)).nexted, true);
  }
  at += 60_000;
  assert.equal((await invoke(families[0], 101)).status, 429);
  at += 86_400_000;
  assert.equal((await invoke(families[1], 102)).nexted, true);
});
test("draft limits fail closed without an authenticated subject", async () => {
  await assert.rejects(consumeDraftLimit(memoryRedis(), {}), { statusCode: 503 });
});

test("draft limit denials audit the operation and trace without draft input", async () => {
  const events = [];
  const middleware = createDraftLimit({ redis: { isReady: false }, audit: async (event) => events.push(event) });
  let status, output;
  const req = { requestId: "quota-trace", assistantOperation: "listings.saveDraft", delegation: { sub: "subject", grantId: "grant", role: "seller" }, body: { description: "private draft canary" } };
  const res = { status(value) { status = value; return this; }, json(value) { output = value; } };
  await middleware(req, res, () => assert.fail("must deny"));
  assert.equal(status, 503);
  assert.equal(output.code, "limit_unavailable");
  assert.equal(events[0].operation, "listings.saveDraft");
  assert.equal(events[0].traceId, "quota-trace");
  assert.equal(events[0].failureReason, "limit_unavailable");
  assert.ok(!JSON.stringify(events).includes("private draft canary"));
  await createDraftLimit({ redis: { isReady: false }, audit: async () => { throw new Error("outage"); } })(req, res, () => assert.fail("must deny"));
  assert.equal(output.code, "audit_unavailable");
});

test("real Redis replicas hold shared draft minute and daily ceilings under concurrency", { skip: process.env.RUN_REDIS_INTEGRATION !== "true" }, async (t) => {
  const first = createClient({ url: process.env.REDIS_URL });
  const second = first.duplicate();
  await Promise.all([first.connect(), second.connect()]);
  const prefix = `shopsphere:test:draft:${process.pid}:${Date.now()}`;
  t.after(async () => {
    try {
      const keys = [];
      for await (const batch of first.scanIterator({ MATCH: `${prefix}:*` })) keys.push(...(Array.isArray(batch) ? batch : [batch]));
      if (keys.length) await first.del(keys);
    } finally { await Promise.all([first.quit(), second.quit()]); }
  });
  const now = 86_400_000;
  const attempts = await Promise.all(Array.from({ length: 25 }, (_, i) => consumeDraftLimit(i % 2 ? first : second, { prefix, subject: "minute-subject", clientId: `rotated-${i}`, grantId: `rotated-${i}`, now })));
  assert.equal(attempts.filter(({ allowed }) => allowed).length, 10);
  for (let i = 0; i < 100; i++) assert.equal((await consumeDraftLimit(i % 2 ? first : second, { prefix, subject: "daily-subject", now: now + i * 60_000 })).allowed, true);
  assert.equal((await consumeDraftLimit(second, { prefix, subject: "daily-subject", now: now + 101 * 60_000 })).allowed, false);
});
