import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAFT_TOPICS,
  MAX_DRAFT_LENGTH,
  MAX_NOTES_LENGTH,
  draftSupportMessage,
} from "./assistantSupportDrafts.js";
import { createDraftSupportLimit } from "./assistantSupportDraftLimits.js";

const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ORDER_ID = "c1c1c1c1c1c1c1c1c1c1c1c1";
const principal = (subject = BUYER) => ({ subject, role: "user", clientId: "client-1", grantId: "grant-1" });
const now = new Date("2026-09-18T10:00:00Z");

const orderRow = (overrides = {}) => ({
  id: ORDER_ID,
  orderNumber: "SP-2026-0001",
  status: "Shipped",
  quantity: 2,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  confirmedAt: new Date("2026-09-01T12:00:00.000Z"),
  processingAt: new Date("2026-09-02T09:00:00.000Z"),
  shippedAt: new Date("2026-09-03T09:00:00.000Z"),
  deliveredAt: null,
  product: { name: "AirPods Pro" },
  ...overrides,
});

const approvedPolicy = (overrides = {}) => ({
  topic: "delivery",
  answer: "Delivery within Pokhara Valley takes 1–2 business days.",
  sources: [{ sourceId: "faqs.json#2", sourceVersion: "1.0.0" }],
  ...overrides,
});

const policySource = async (policyTopic) => approvedPolicy({ topic: policyTopic });

// Captures every property access and method invocation on the fake client so
// tests can prove exactly which Prisma operations the service attempted.
const captureClient = (handlers = {}) => {
  const calls = [];
  const make = (path) => new Proxy(function () {}, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      return make([...path, String(prop)]);
    },
    async apply(_target, _thisArg, args) {
      const name = path.join(".");
      calls.push(name);
      const handler = handlers[name];
      return handler ? handler(...args) : null;
    },
  });
  return { client: make([]), calls };
};

test("draft reads the owned order through immutable buyer attribution only", async () => {
  let where;
  let select;
  const client = {
    order: {
      findFirst: async (args) => {
        where = args.where;
        select = args.select;
        return orderRow();
      },
    },
  };
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "delivery_issue" },
    { client, principal: principal(), policySource, now },
  );
  // The scope predicate is the immutable Order.userId attribution resolved
  // server-side from the delegated subject — never an email, never an OR.
  assert.deepEqual(where, { id: ORDER_ID, userId: BUYER });
  assert.ok(!JSON.stringify(where).toLowerCase().includes("email"));
  assert.ok(!("OR" in where));
  const selectText = JSON.stringify(select);
  for (const banned of ["email", "firstName", "lastName", "deliveryStreet", "returnReason", "promoCode", "totalPrice"]) {
    assert.ok(!selectText.includes(banned), banned);
  }
  assert.equal(output.orderId, ORDER_ID);
  assert.ok(output.draft.includes("SP-2026-0001"));
});

test("foreign and missing orders produce the identical generic not-found", async () => {
  const { client, calls } = captureClient({
    "order.findFirst": (args) =>
      args.where.userId === BUYER && args.where.id === ORDER_ID ? orderRow() : null,
  });
  const ctx = (subject) => ({ client, principal: principal(subject), policySource, now });
  const capture = (promise) => promise.then(() => null, (error) => error);
  const missing = await capture(draftSupportMessage({ orderId: "e1e1e1e1e1e1e1e1e1e1e1e1", topic: "other" }, ctx(BUYER)));
  const foreign = await capture(draftSupportMessage({ orderId: ORDER_ID, topic: "other" }, ctx(RIVAL)));
  assert.ok(missing && foreign, "both attempts reject");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.code, "not_found");
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.code, "not_found");
  assert.equal(missing.message, foreign.message);
  // One scoped read per attempt; no separate existence probe and no other
  // client operations of any kind.
  assert.deepEqual(calls, ["order.findFirst", "order.findFirst"]);
});

test("malformed or missing order ids are generic not-found, not bad-input", async () => {
  const { client, calls } = captureClient();
  const ctx = { client, principal: principal(), policySource, now };
  await assert.rejects(draftSupportMessage({ orderId: "", topic: "other" }, ctx), { statusCode: 404 });
  await assert.rejects(draftSupportMessage({ topic: "other" }, ctx), { statusCode: 404 });
  await assert.rejects(draftSupportMessage({ orderId: "x".repeat(25), topic: "other" }, ctx), { statusCode: 404 });
  await assert.rejects(draftSupportMessage({ orderId: ORDER_ID, topic: "not-a-topic" }, ctx), { statusCode: 400 });
  assert.deepEqual(calls, []);
});

test("absent order facts render as unknown and timestamps never appear", async () => {
  const client = {
    order: {
      findFirst: async () => orderRow({
        orderNumber: null,
        status: "",
        createdAt: null,
        quantity: null,
        product: null,
        confirmedAt: null,
        processingAt: null,
        shippedAt: null,
        deliveredAt: null,
      }),
    },
  };
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "order_status" },
    { client, principal: principal(), policySource, now },
  );
  assert.ok(output.draft.includes("Order number: unknown"));
  assert.ok(output.draft.includes("Order status: unknown"));
  assert.ok(output.draft.includes("Placed at: unknown"));
  assert.ok(output.draft.includes("Item: unknown"));
  assert.ok(output.draft.includes("Delivery stage: unknown"));
  // No fact was invented: the draft body carries no timestamps at all.
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(output.draft));
});

test("partial facts degrade independently and the stage stays coarse", async () => {
  const client = {
    order: {
      findFirst: async () => orderRow({ product: { name: "" } }),
    },
  };
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "delivery_issue" },
    { client, principal: principal(), policySource, now },
  );
  assert.ok(output.draft.includes("Item: unknown (quantity: 2)"));
  // Milestone timestamps exist but only the coarse stage label is rendered.
  assert.ok(output.draft.includes("Delivery stage: Shipped"));
  assert.ok(!output.draft.includes("2026-09-01T12:00:00.000Z"));
  assert.ok(!output.draft.includes("2026-09-02T09:00:00.000Z"));
  assert.ok(!output.draft.includes("2026-09-03T09:00:00.000Z"));
});

test("citations come from the injected policy source with versioned source ids", async () => {
  const seen = [];
  const client = { order: { findFirst: async () => orderRow() } };
  const source = async (policyTopic) => {
    seen.push(policyTopic);
    return approvedPolicy({
      topic: policyTopic,
      sources: [{ sourceId: "faqs.json#7", sourceVersion: "1.2.3" }],
    });
  };
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "refund_question" },
    { client, principal: principal(), policySource: source, now },
  );
  assert.deepEqual(seen, ["payment"]);
  assert.deepEqual(output.citations, [{ sourceId: "faqs.json#7", sourceVersion: "1.2.3" }]);
  assert.ok(output.draft.includes("Delivery within Pokhara Valley takes 1–2 business days."));
});

test("every bounded topic maps onto an approved policy topic", async () => {
  const mapping = {
    order_status: "tracking",
    delivery_issue: "delivery",
    return_question: "returns",
    refund_question: "payment",
    other: "support-contact",
  };
  assert.deepEqual([...DRAFT_TOPICS], Object.keys(mapping));
  const client = { order: { findFirst: async () => orderRow() } };
  for (const [topic, policyTopic] of Object.entries(mapping)) {
    const seen = [];
    await draftSupportMessage(
      { orderId: ORDER_ID, topic },
      { client, principal: principal(), policySource: async (seen_topic) => { seen.push(seen_topic); return approvedPolicy(); }, now },
    );
    assert.deepEqual(seen, [policyTopic], topic);
  }
});

test("topics without an approved policy source say so instead of inventing guidance", async () => {
  const client = { order: { findFirst: async () => orderRow() } };
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "other" },
    {
      client,
      principal: principal(),
      policySource: async () => approvedPolicy({ answer: "", sources: [] }),
      now,
    },
  );
  assert.deepEqual(output.citations, []);
  assert.ok(output.draft.includes("No approved ShopSphere policy is available for this topic"));
  assert.ok(!output.draft.includes("Delivery within Pokhara Valley"));
});

test("drafts are bounded to 4000 characters and report truncation", async () => {
  const client = { order: { findFirst: async () => orderRow() } };
  const longAnswer = "Approved ShopSphere policy sentence. ".repeat(400);
  const oversized = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "delivery_issue" },
    { client, principal: principal(), policySource: async () => approvedPolicy({ answer: longAnswer }), now },
  );
  assert.ok(oversized.draft.length <= MAX_DRAFT_LENGTH);
  assert.equal(oversized.truncated, true);
  // The cut lands on a whitespace boundary, ending on a complete word.
  assert.ok(
    ["Approved", "ShopSphere", "policy", "sentence."].some((word) => oversized.draft.endsWith(word)),
    oversized.draft.slice(-40),
  );
  const bounded = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "delivery_issue" },
    { client, principal: principal(), policySource, now },
  );
  assert.equal(bounded.truncated, false);
  assert.ok(bounded.draft.length <= MAX_DRAFT_LENGTH);
});

test("buyer notes are bounded to 500 characters and included exactly once", async () => {
  const client = { order: { findFirst: async () => orderRow() } };
  const marker = "NOTE-MARKER";
  const notes = `${marker}${"x".repeat(700)}`;
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "other", notes },
    { client, principal: principal(), policySource, now },
  );
  assert.equal(output.draft.split(marker).length - 1, 1);
  assert.ok(output.draft.includes(`${marker}${"x".repeat(MAX_NOTES_LENGTH - marker.length)}`));
  assert.ok(!output.draft.includes("x".repeat(MAX_NOTES_LENGTH + 1)));
  const withoutNotes = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "other" },
    { client, principal: principal(), policySource, now },
  );
  assert.ok(!withoutNotes.draft.includes("Notes from the buyer"));
});

test("drafting performs only the owned-order read and exposes no delivery affordance", async () => {
  const { client, calls } = captureClient({ "order.findFirst": () => orderRow() });
  const output = await draftSupportMessage(
    { orderId: ORDER_ID, topic: "return_question", notes: "The box arrived crushed." },
    { client, principal: principal(), policySource, now },
  );
  assert.deepEqual(calls, ["order.findFirst"]);
  assert.deepEqual(
    Object.keys(output).sort(),
    ["citations", "draft", "generatedAt", "orderId", "topic", "truncated"],
  );
  const serialized = JSON.stringify(output).toLowerCase();
  for (const banned of ["recipient", "channel", "send", "submit", "ticket", "email", "webhook", "notification", "mailto"]) {
    assert.ok(!serialized.includes(banned), banned);
  }
  assert.equal(output.generatedAt, "2026-09-18T10:00:00.000Z");
});

// --- Route-scoped draft limits (backend/services/assistantSupportDraftLimits.js) ---

const fakeRedis = () => {
  const counters = new Map();
  return {
    isReady: true,
    async eval(_lua, { keys, arguments: args }) {
      const limit = Number(args[1]);
      const current = (counters.get(keys[0]) ?? 0) + 1;
      counters.set(keys[0], current);
      return current > limit ? [0, 45_000] : [1, 45_000];
    },
  };
};

const callLimit = async (middleware, { subject = BUYER } = {}) => {
  const headers = {};
  let status;
  let body;
  let nexted = false;
  const res = {
    set: (key, value) => { headers[key] = value; },
    status: (code) => { status = code; return res; },
    json: (payload) => { body = payload; return res; },
  };
  await middleware({ delegation: { sub: subject, clientId: "client-1" } }, res, () => { nexted = true; });
  return { nexted, status, body, headers };
};

test("draft limits allow traffic under 10/minute and 100/day per subject+client", async () => {
  const middleware = createDraftSupportLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) {
    const result = await callLimit(middleware);
    assert.equal(result.nexted, true);
  }
});

test("draft limits return 429 rate_limited past the minute window", async () => {
  const middleware = createDraftSupportLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) await callLimit(middleware);
  const result = await callLimit(middleware);
  assert.equal(result.nexted, false);
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "rate_limited");
  assert.ok(Number(result.headers["retry-after"]) >= 1);
});

test("draft limits return 429 rate_limited past the daily window", async () => {
  let tick = 0;
  // Each call lands in a fresh minute bucket, so only the day counter accrues.
  const middleware = createDraftSupportLimit({
    redis: fakeRedis(),
    now: () => 1_760_000_000_000 + (tick++) * 61_000,
  });
  for (let index = 0; index < 100; index += 1) {
    const result = await callLimit(middleware);
    assert.equal(result.nexted, true, index);
  }
  const result = await callLimit(middleware);
  assert.equal(result.nexted, false);
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "rate_limited");
});

test("draft limits key per subject+client", async () => {
  const middleware = createDraftSupportLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) await callLimit(middleware, { subject: BUYER });
  const otherSubject = await callLimit(middleware, { subject: RIVAL });
  assert.equal(otherSubject.nexted, true);
  const sameSubject = await callLimit(middleware, { subject: BUYER });
  assert.equal(sameSubject.status, 429);
});

test("draft limits fail closed with 503 when Redis is unavailable", async () => {
  const notReady = createDraftSupportLimit({ redis: { isReady: false }, now: () => 1_760_000_000_000 });
  const notReadyResult = await callLimit(notReady);
  assert.equal(notReadyResult.nexted, false);
  assert.equal(notReadyResult.status, 503);
  assert.equal(notReadyResult.body.code, "limit_unavailable");

  const failing = createDraftSupportLimit({
    redis: { isReady: true, eval: async () => { throw new Error("connection lost"); } },
    now: () => 1_760_000_000_000,
  });
  const failingResult = await callLimit(failing);
  assert.equal(failingResult.nexted, false);
  assert.equal(failingResult.status, 503);
  assert.equal(failingResult.body.code, "limit_unavailable");
});
