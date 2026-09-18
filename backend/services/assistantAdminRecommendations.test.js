// Adversarial units for the #21 admin recommendation drafts. A capture proxy
// records every Prisma operation the service attempts, so the tests prove the
// drafts only perform the minimized admin reads — never a mutation, count
// reset, activation, notification, or email. Composition is deterministic:
// restating only authorized minimized facts, rendering absent facts as the
// literal "unknown", bounding the text to 4000 characters, and citing
// versioned policy sources. The recommendation text is structurally checked to
// never carry imperative decision commands: drafting recommends, it never
// decides.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  MAX_DRAFT_LENGTH,
  MAX_PURPOSE_CHARS,
  PROMOTION_REVIEW_POLICY_TOPIC,
  RETURN_REVIEW_POLICY_TOPIC,
  SELLER_REVIEW_POLICY_TOPIC,
  draftPromotionRecommendation,
  draftReturnReviewRecommendation,
  draftSellerReviewRecommendation,
  returnReviewObserve,
} from "./assistantAdminRecommendations.js";
import { createRecommendationLimit } from "./assistantRecommendationLimits.js";
import { RETURN_STATUSES } from "./assistantAdminQueues.js";
import { ASSISTANT_POLICY_VERSION } from "./assistantPublicCatalog.js";

const ADMIN = "cccccccccccccccccccccccc";
const SELLER_ID = "dddddddddddddddddddddddd";
const ORDER_ID = "e2e2e2e2e2e2e2e2e2e2e2e2";
const PROMO_ID = "f3f3f3f3f3f3f3f3f3f3f3f3";
const now = new Date("2026-09-19T10:00:00Z");

const adminPrincipal = () => ({ subject: ADMIN, role: "admin", clientId: "client-1", grantId: "grant-1" });

// Same derivation as the #16 admin read: seller-<sha256("shopsphere-seller:"+id).slice(0,12)>.
const sellerReferenceOf = (userId) =>
  `seller-${crypto.createHash("sha256").update(`shopsphere-seller:${userId}`).digest("hex").slice(0, 12)}`;
const REF = sellerReferenceOf(SELLER_ID);

const approvedPolicy = (overrides = {}) => ({
  topic: SELLER_REVIEW_POLICY_TOPIC,
  answer: "Submit seller details for verification.",
  sources: [{ sourceId: "faqs.json#12", sourceVersion: ASSISTANT_POLICY_VERSION }],
  ...overrides,
});
const policySource = async (topic) => approvedPolicy({ topic });

const sellerRow = (overrides = {}) => ({
  id: SELLER_ID,
  shopName: "Ada's Gadgets",
  shopDescription: "Gadgets sourced from approved distributors.",
  isVerified: false,
  verificationRequestDate: new Date("2026-09-10T08:00:00.000Z"),
  verificationApprovedDate: null,
  verificationRejectionReason: null,
  createdAt: new Date("2026-09-09T08:00:00.000Z"),
  ...overrides,
});

const orderRow = (overrides = {}) => ({
  id: ORDER_ID,
  orderNumber: "SP-2026-0007",
  status: "Return Requested",
  returnRequestedAt: new Date("2026-09-15T09:00:00.000Z"),
  returnReason: "The device arrived with a cracked case.",
  returnImage: "uploads/returns/private-evidence.png",
  ...overrides,
});

const promoRow = (overrides = {}) => ({
  id: PROMO_ID,
  code: "SAVE20",
  discountType: "percentage",
  discountValue: "20.00",
  minPurchase: "100.00",
  maxDiscount: null,
  usageLimit: null,
  usedCount: 12,
  validFrom: new Date("2026-09-01T00:00:00.000Z"),
  validUntil: new Date("2026-12-31T00:00:00.000Z"),
  isActive: true,
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  ...overrides,
});

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

const rejectionOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

const assertNoDecisions = (output) => {
  assert.deepEqual(
    Object.keys(output).sort(),
    ["citations", "generatedAt", "recommendation", "truncated"],
  );
  for (const line of output.recommendation.split("\n")) {
    assert.ok(
      !/^(approve|reject|release|refund|activate|deactivate|reset|notify|send|email|toggle|post)\b/i.test(line.trim()),
      `imperative decision line leaked: ${line}`,
    );
  }
  assert.ok(output.recommendation.includes("not a decision"), "draft must disclaim decision authority");
  assert.ok(output.recommendation.length <= MAX_DRAFT_LENGTH);
};

// --- Seller review recommendation -------------------------------------------

test("seller review resolves the opaque reference by re-deriving it over the bounded application scan", async () => {
  const seenTopics = [];
  const source = async (topic) => {
    seenTopics.push(topic);
    return approvedPolicy({ topic });
  };
  let where;
  let select;
  const { client, calls } = captureClient({
    "user.findMany": (args) => {
      where = where ?? args.where;
      select = select ?? args.select;
      return [sellerRow({ id: `aaaa${"0".repeat(20)}` }), sellerRow()];
    },
  });
  const output = await draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), policySource: source, now },
  );
  // The scan predicate is fixed: seller accounts only, no caller-supplied
  // filter, and never an email or raw-id lookup.
  assert.deepEqual(where, { role: "seller" });
  assert.equal(seenTopics.join(","), SELLER_REVIEW_POLICY_TOPIC);
  const selectText = JSON.stringify(select);
  for (const banned of ["email", "firstName", "lastName", "phone", "password", "homeAddress", "verificationToken"]) {
    assert.ok(!selectText.toLowerCase().includes(banned.toLowerCase()), banned);
  }
  // Exactly one bounded read for a hit on the first page.
  assert.deepEqual(calls, ["user.findMany"]);
  assert.ok(output.recommendation.includes(REF));
  assert.ok(output.recommendation.includes("Ada's Gadgets"));
  assert.ok(output.recommendation.includes("Application status: pending"));
  assert.ok(output.recommendation.includes("Submit seller details for verification."));
  assert.deepEqual(output.citations, [{ sourceId: "faqs.json#12", sourceVersion: ASSISTANT_POLICY_VERSION }]);
  assert.equal(output.truncated, false);
  assert.equal(output.generatedAt, "2026-09-19T10:00:00.000Z");
  assertNoDecisions(output);
});

test("seller review uses the real approved policy source with versioned citations", async () => {
  const client = { user: { findMany: async () => [sellerRow()] } };
  const output = await draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), now },
  );
  assert.deepEqual(
    output.citations,
    [{ sourceId: "faqs.json#12", sourceVersion: ASSISTANT_POLICY_VERSION }],
  );
  assert.ok(output.recommendation.includes("admin verification"));
});

test("seller review: malformed, foreign, and missing references are the identical generic not-found", async () => {
  const { client, calls } = captureClient({ "user.findMany": () => [] });
  const ctx = { client, principal: adminPrincipal(), policySource, now };
  const malformed = await rejectionOf(draftSellerReviewRecommendation({ sellerReference: "seller-ZZZZ" }, ctx));
  const rawId = await rejectionOf(draftSellerReviewRecommendation({ sellerReference: SELLER_ID }, ctx));
  const missing = await rejectionOf(draftSellerReviewRecommendation({ sellerReference: "seller-000000000000" }, ctx));
  const foreignClient = captureClient({ "user.findMany": () => [] });
  const foreign = await rejectionOf(draftSellerReviewRecommendation({ sellerReference: REF }, {
    client: foreignClient.client,
    principal: adminPrincipal(),
    policySource,
    now,
  }));
  for (const error of [malformed, rawId, missing, foreign]) {
    assert.ok(error, "expected rejection");
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "not_found");
    assert.equal(error.message, "Resource not found");
  }
  // Malformed input is rejected before any read happens; the bounded scan
  // performs exactly one page read per well-formed miss.
  assert.deepEqual(calls, ["user.findMany"]);
  assert.deepEqual(foreignClient.calls, ["user.findMany"]);
});

test("seller review scan is bounded even when no account matches", async () => {
  const pageOfStrangers = () => Array.from({ length: 100 }, (_, index) => sellerRow({ id: `b${String(index).padStart(23, "0")}` }));
  const { client, calls } = captureClient({ "user.findMany": () => pageOfStrangers() });
  const error = await rejectionOf(draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), policySource, now },
  ));
  assert.equal(error.statusCode, 404);
  assert.equal(calls.length, 10, "the scan must stop at its fixed page bound");
});

test("seller review renders absent application facts as unknown, never inferred", async () => {
  const client = {
    user: { findMany: async () => [sellerRow({
      shopName: "",
      shopDescription: null,
      verificationRequestDate: null,
    })] },
  };
  const output = await draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), policySource, now },
  );
  assert.ok(output.recommendation.includes("Shop name: unknown"));
  assert.ok(output.recommendation.includes("Requested at: unknown"));
  assert.ok(output.recommendation.includes("Decision date: unknown"));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(output.recommendation), "no invented timestamps");
});

// --- Return review recommendation -------------------------------------------

test("return review resolves through the exact fixed return-queue membership rule", async () => {
  const seenTopics = [];
  const returnsAnswer = "You can return any product within 7 days of delivery.";
  const source = async (topic) => {
    seenTopics.push(topic);
    return approvedPolicy({
      topic,
      answer: returnsAnswer,
      sources: [{ sourceId: "faqs.json#1", sourceVersion: ASSISTANT_POLICY_VERSION }],
    });
  };
  let where;
  let select;
  const { client, calls } = captureClient({
    "order.findFirst": (args) => {
      where = where ?? args.where;
      select = select ?? args.select;
      return orderRow();
    },
  });
  const output = await draftReturnReviewRecommendation(
    { orderId: ORDER_ID, purpose: "Preparing the weekly return review packet" },
    { client, principal: adminPrincipal(), policySource: source, now },
  );
  assert.equal(seenTopics.join(","), RETURN_REVIEW_POLICY_TOPIC);
  // Fixed rule: id + rolling 90-day window + return lifecycle statuses +
  // requested return + attribution quarantine. No caller-supplied filter and
  // no storefront fallback.
  assert.deepEqual(where.AND[0], { id: ORDER_ID });
  assert.deepEqual(where.AND[1].createdAt, {
    gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
    lte: now,
  });
  assert.deepEqual(where.AND[2].AND[0].status.in, [...RETURN_STATUSES]);
  assert.deepEqual(where.AND[2].AND[1], { returnRequestedAt: { not: null } });
  assert.deepEqual(where.AND[3].OR, [{ userId: { not: null } }, { sellerIdAtPurchase: { not: null } }]);
  assert.ok(!("OR" in where));
  // returnImage is read only to compute the boolean; the path never leaves.
  assert.equal(select.returnImage, true);
  assert.ok(!JSON.stringify(select).includes("refunds"));
  assert.deepEqual(calls, ["order.findFirst"]);
  assert.ok(output.recommendation.includes("SP-2026-0007"));
  assert.ok(output.recommendation.includes("Return Requested"));
  assert.ok(output.recommendation.includes("The device arrived with a cracked case."));
  assert.ok(output.recommendation.includes("Return image attached: yes"));
  assert.ok(!output.recommendation.includes("uploads"), "the image path must never appear");
  assert.ok(output.recommendation.includes("You can return any product within 7 days"));  assert.deepEqual(output.citations, [{ sourceId: "faqs.json#1", sourceVersion: ASSISTANT_POLICY_VERSION }]);
  assertNoDecisions(output);
});

test("return review: foreign and missing orders are the identical generic not-found", async () => {
  const { client, calls } = captureClient({ "order.findFirst": () => null });
  const ctx = { client, principal: adminPrincipal(), policySource, now };
  const capture = (promise) => rejectionOf(promise);
  const missing = await capture(draftReturnReviewRecommendation({ orderId: "9f9f9f9f9f9f9f9f9f9f9f9f", purpose: "Preparing the weekly return review" }, ctx));
  const foreignClient = captureClient({ "order.findFirst": () => null });
  const foreign = await capture(draftReturnReviewRecommendation({ orderId: ORDER_ID, purpose: "Preparing the weekly return review" }, {
    ...ctx,
    client: foreignClient.client,
  }));
  for (const error of [missing, foreign]) {
    assert.ok(error, "expected rejection");
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "not_found");
    assert.equal(error.message, "Resource not found");
  }
  // Exactly one scoped read per attempt: no existence probe, nothing else.
  assert.deepEqual(calls, ["order.findFirst"]);
  assert.deepEqual(foreignClient.calls, ["order.findFirst"]);
});

test("return review validates the audited purpose before reading and bounds it into audit metadata", async () => {
  const { client, calls } = captureClient({ "order.findFirst": () => orderRow() });
  const ctx = { client, principal: adminPrincipal(), policySource, now };
  const tooShort = await rejectionOf(draftReturnReviewRecommendation({ orderId: ORDER_ID, purpose: "short" }, ctx));
  assert.equal(tooShort.statusCode, 400);
  assert.equal(tooShort.code, "invalid_input");
  const tooLong = await rejectionOf(draftReturnReviewRecommendation({ orderId: ORDER_ID, purpose: "x".repeat(501) }, ctx));
  assert.equal(tooLong.statusCode, 400);
  assert.deepEqual(calls, [], "no read may happen for invalid purposes");

  const longPurpose = `AUDIT-MARKER ${"y".repeat(700)}`;
  // The observe() seam bounds an over-long purpose into the durable audit
  // metadata as defense in depth, mirroring the queue detail tool.
  const observed = returnReviewObserve(
    { recommendation: "draft", truncated: false, citations: [], generatedAt: "2026-09-19T10:00:00.000Z" },
    { orderId: ORDER_ID, purpose: longPurpose },
  );
  assert.equal(observed.rowCount, 1);
  assert.deepEqual(observed.resourceIds, [ORDER_ID]);
  assert.equal(observed.auditMetadata.purpose.length, MAX_PURPOSE_CHARS);
  assert.ok(observed.auditMetadata.purpose.startsWith("AUDIT-MARKER"));
  // The purpose is audit metadata only — it never rides back in the response.
  assert.ok(!JSON.stringify(observed).includes("y".repeat(600)));
});

// --- Promotion review recommendation ----------------------------------------

test("promotion review reads the allowlisted configuration and counts redeemers only through an aggregate", async () => {
  const seenTopics = [];
  const source = async (topic) => {
    seenTopics.push(topic);
    return approvedPolicy({ topic });
  };
  let select;
  let groupArgs;
  const { client, calls } = captureClient({
    "promoCode.findFirst": (args) => {
      select = args.select;
      return promoRow({ usageLimit: 100, usedCount: 85 });
    },
    "promoCodeUsage.groupBy": (args) => {
      groupArgs = args;
      return [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }];
    },
  });
  const output = await draftPromotionRecommendation(
    { promoCodeId: PROMO_ID },
    { client, principal: adminPrincipal(), policySource: source, now },
  );
  assert.equal(seenTopics.join(","), PROMOTION_REVIEW_POLICY_TOPIC);
  assert.ok(!JSON.stringify(select).includes("createdById"));
  assert.deepEqual(groupArgs.by, ["userId"]);
  assert.deepEqual(groupArgs.where, { promoCodeId: PROMO_ID });
  // Aggregate-only: the usages table is grouped, never read back as rows.
  assert.deepEqual(calls, ["promoCode.findFirst", "promoCodeUsage.groupBy"]);
  assert.ok(output.recommendation.includes("SAVE20"));
  assert.ok(output.recommendation.includes("percentage, 20 percent"));
  assert.ok(output.recommendation.includes("Total redemptions recorded: 85"));
  assert.ok(output.recommendation.includes("Distinct users recorded: 3"));
  assert.ok(output.recommendation.includes("Usage limit: 100"));
  assert.ok(output.recommendation.includes("usage is approaching the configured limit"));
  // No per-user data of any kind.
  assert.ok(!JSON.stringify(output).includes("userId"));
  assert.ok(!JSON.stringify(output).includes("u1"));
  assertNoDecisions(output);
});

test("promotion review states explicitly when no approved policy source exists for promotions", async () => {
  const { client } = captureClient({
    "promoCode.findFirst": () => promoRow(),
    "promoCodeUsage.groupBy": () => [{ userId: "u1" }],
  });
  const output = await draftPromotionRecommendation(
    { promoCodeId: PROMO_ID },
    {
      client,
      principal: adminPrincipal(),
      policySource: async (topic) => approvedPolicy({ topic, sources: [] }),
      now,
    },
  );
  assert.deepEqual(output.citations, []);
  assert.ok(output.recommendation.includes("No approved ShopSphere policy is available for this topic"));
  assert.ok(!output.recommendation.includes("Submit seller details"));
});

test("promotion review next-step text is grounded in configuration and aggregate usage only", async () => {
  const cases = [
    {
      row: promoRow({ usageLimit: 100, usedCount: 100 }),
      fragment: "reached the configured usage limit",
    },
    {
      row: promoRow({ isActive: false, usageLimit: null, usedCount: 3 }),
      fragment: "currently inactive",
    },
    {
      row: promoRow({ validUntil: new Date("2026-09-10T00:00:00.000Z"), usageLimit: null }),
      fragment: "validity window has ended",
    },
    {
      row: promoRow({ usageLimit: null, usedCount: 0 }),
      fragment: "no usage limit is configured",
    },
  ];
  for (const { row, fragment } of cases) {
    const { client } = captureClient({
      "promoCode.findFirst": () => row,
      "promoCodeUsage.groupBy": () => [{ userId: "u1" }],
    });
    const output = await draftPromotionRecommendation(
      { promoCodeId: PROMO_ID },
      { client, principal: adminPrincipal(), policySource, now },
    );
    assert.ok(output.recommendation.includes(fragment), fragment);
  }
});

test("promotion review: missing and malformed ids are the identical generic not-found", async () => {
  const { client, calls } = captureClient({
    "promoCode.findFirst": () => null,
  });
  const ctx = { client, principal: adminPrincipal(), policySource, now };
  const missing = await rejectionOf(draftPromotionRecommendation({ promoCodeId: "0f0f0f0f0f0f0f0f0f0f0f0f" }, ctx));
  const malformed = await rejectionOf(draftPromotionRecommendation({ promoCodeId: "x".repeat(101) }, ctx));
  for (const error of [missing, malformed]) {
    assert.ok(error, "expected rejection");
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "not_found");
    assert.equal(error.message, "Resource not found");
  }
  // Malformed ids never reach the database; the miss performs exactly one
  // configuration read and no usage read.
  assert.deepEqual(calls, ["promoCode.findFirst"]);
});

// --- Cross-cutting guarantees -------------------------------------------------

test("drafts bound the text to 4000 characters on a whitespace boundary and report truncation", async () => {
  const longAnswer = "Approved ShopSphere policy sentence. ".repeat(400);
  const client = { user: { findMany: async () => [sellerRow()] } };
  const oversized = await draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), policySource: async () => approvedPolicy({ answer: longAnswer }), now },
  );
  assert.equal(oversized.truncated, true);
  assert.ok(oversized.recommendation.length <= MAX_DRAFT_LENGTH);
  assert.ok(
    ["Approved", "ShopSphere", "policy", "sentence."].some((word) => oversized.recommendation.endsWith(word)),
    oversized.recommendation.slice(-40),
  );
  const bounded = await draftSellerReviewRecommendation(
    { sellerReference: REF },
    { client, principal: adminPrincipal(), policySource, now },
  );
  assert.equal(bounded.truncated, false);
});

test("drafting performs only reads: no mutation, reset, activation, or notification path exists", async () => {
  const { client, calls } = captureClient({
    "user.findMany": () => [sellerRow()],
    "order.findFirst": () => orderRow(),
    "promoCode.findFirst": () => promoRow({ usageLimit: 100, usedCount: 85 }),
    "promoCodeUsage.groupBy": () => [{ userId: "u1" }, { userId: "u2" }],
  });
  const ctx = { client, principal: adminPrincipal(), policySource, now };
  const seller = await draftSellerReviewRecommendation({ sellerReference: REF }, ctx);
  const ret = await draftReturnReviewRecommendation({ orderId: ORDER_ID, purpose: "Preparing the weekly return review" }, ctx);
  const promo = await draftPromotionRecommendation({ promoCodeId: PROMO_ID }, ctx);
  // The full captured operation list proves the drafts are read-only: only the
  // minimized admin projections were touched, nothing else was attempted.
  assert.deepEqual(calls, [
    "user.findMany",
    "order.findFirst",
    "promoCode.findFirst",
    "promoCodeUsage.groupBy",
  ]);
  for (const output of [seller, ret, promo]) {
    const serialized = JSON.stringify(output).toLowerCase();
    for (const banned of ["upsert", "update", "delete", "create", "notification", "email", "webhook", "usedcount:"]) {
      assert.ok(!serialized.includes(banned), banned);
    }
    assertNoDecisions(output);
  }
});

test("non-admin principals are rejected before any read (defense in depth)", async () => {
  const { client, calls } = captureClient();
  const ctx = { client, principal: { subject: ADMIN, role: "seller", clientId: "c", grantId: "g" }, policySource, now };
  for (const attempt of [
    draftSellerReviewRecommendation({ sellerReference: REF }, ctx),
    draftReturnReviewRecommendation({ orderId: ORDER_ID, purpose: "Preparing the weekly return review" }, ctx),
    draftPromotionRecommendation({ promoCodeId: PROMO_ID }, ctx),
  ]) {
    const error = await rejectionOf(attempt);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "role_not_allowed");
  }
  assert.deepEqual(calls, []);
});

// --- Route-scoped recommendation limits ---------------------------------------

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

const callLimit = async (middleware, { subject = ADMIN } = {}) => {
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

test("recommendation limits allow traffic under 10/minute and 100/day per subject+client", async () => {
  const middleware = createRecommendationLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) {
    const result = await callLimit(middleware);
    assert.equal(result.nexted, true);
  }
});

test("recommendation limits return 429 rate_limited past the minute window", async () => {
  const middleware = createRecommendationLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) await callLimit(middleware);
  const result = await callLimit(middleware);
  assert.equal(result.nexted, false);
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "rate_limited");
  assert.ok(Number(result.headers["retry-after"]) >= 1);
});

test("recommendation limits return 429 rate_limited past the daily window", async () => {
  let tick = 0;
  const middleware = createRecommendationLimit({
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

test("recommendation limits key per subject+client", async () => {
  const middleware = createRecommendationLimit({ redis: fakeRedis(), now: () => 1_760_000_000_000 });
  for (let index = 0; index < 10; index += 1) await callLimit(middleware, { subject: ADMIN });
  const otherSubject = await callLimit(middleware, { subject: "eeeeeeeeeeeeeeeeeeeeeeee" });
  assert.equal(otherSubject.nexted, true);
  const sameSubject = await callLimit(middleware, { subject: ADMIN });
  assert.equal(sameSubject.status, 429);
});

test("recommendation limits fail closed with 503 when Redis is unavailable", async () => {
  const notReady = createRecommendationLimit({ redis: { isReady: false }, now: () => 1_760_000_000_000 });
  const notReadyResult = await callLimit(notReady);
  assert.equal(notReadyResult.nexted, false);
  assert.equal(notReadyResult.status, 503);
  assert.equal(notReadyResult.body.code, "limit_unavailable");

  const failing = createRecommendationLimit({
    redis: { isReady: true, eval: async () => { throw new Error("connection lost"); } },
    now: () => 1_760_000_000_000,
  });
  const failingResult = await callLimit(failing);
  assert.equal(failingResult.nexted, false);
  assert.equal(failingResult.status, 503);
  assert.equal(failingResult.body.code, "limit_unavailable");
});
