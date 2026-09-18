import assert from "node:assert/strict";
import test from "node:test";

import {
  getPromotionUsageSummary,
  listPromotionConfiguration,
} from "./assistantAdminPromotions.js";

const ADMIN = "eeeeeeeeeeeeeeeeeeeeeeee";
const OTHER_ADMIN = "777777777777777777777777";
const BUYER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "admin-promotions-cursor-secret-at-least-32-bytes!";
const adminPrincipal = (subject = ADMIN) => ({ subject, role: "admin", clientId: "client-1", grantId: "grant-1" });
const sellerPrincipal = { subject: "bbbbbbbbbbbbbbbbbbbbbbbb", role: "seller", clientId: "client-1", grantId: "grant-1" };
const userPrincipal = { subject: BUYER, role: "user", clientId: "client-1", grantId: "grant-1" };

const PROMO_ID = "f9f9f9f9f9f9f9f9f9f9f9f9";
const CREATOR_ID = "111111111111111111111111";

const promoRow = (overrides = {}) => ({
  id: PROMO_ID,
  code: "RLS10",
  discountType: "percentage",
  discountValue: "10.00",
  minPurchase: "0.00",
  maxDiscount: null,
  usageLimit: null,
  usedCount: 3,
  validFrom: new Date("2026-09-01T00:00:00Z"),
  validUntil: new Date("2026-12-31T00:00:00Z"),
  isActive: true,
  createdAt: new Date("2026-08-31T00:00:00Z"),
  // Present on raw rows; must never reach an output.
  createdById: CREATOR_ID,
  ...overrides,
});

// Fake Prisma client that records every model/method it is asked for. Only the
// read methods used by the service exist, so a mutation call throws instead of
// silently succeeding.
const fakeClient = ({ promos = [], promo = undefined, usageGroups = [] } = {}) => {
  const calls = [];
  const client = {
    promoCode: {
      findMany: async (args) => {
        calls.push({ model: "promoCode", method: "findMany", args });
        return promos;
      },
      findFirst: async (args) => {
        calls.push({ model: "promoCode", method: "findFirst", args });
        return promo === undefined ? (promos[0] ?? null) : promo;
      },
    },
    promoCodeUsage: {
      groupBy: async (args) => {
        calls.push({ model: "promoCodeUsage", method: "groupBy", args });
        return usageGroups;
      },
    },
  };
  return { client, calls };
};

const READ_METHODS = new Set(["findMany", "findFirst", "groupBy", "count", "aggregate"]);

const assertReadOnly = (calls) => {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok(call.model === "promoCode" || call.model === "promoCodeUsage", `unexpected model ${call.model}`);
    assert.ok(READ_METHODS.has(call.method), `non-read method used: ${call.method}`);
    assert.ok(!/create|update|delete|upsert/i.test(call.method), `mutation-shaped method used: ${call.method}`);
  }
};

test("configuration list projects one bounded allowlisted page", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => promoRow({
    id: `promo-${String(index).padStart(2, "0")}`,
    createdAt: new Date(Date.UTC(2026, 7, 31 - index)),
  }));
  const { client, calls } = fakeClient({ promos: rows });
  const output = await listPromotionConfiguration({}, { client, principal: adminPrincipal(), cursorSecret: SECRET });
  const findMany = calls.find((call) => call.method === "findMany");
  assert.equal(findMany.args.take, 21);
  assert.deepEqual(findMany.args.where, {});
  assert.deepEqual(findMany.args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(output.promotions.length, 20);
  assert.ok(output.nextCursor);
  // Allowlist only: creator identity and promo description are not projected.
  assert.equal(findMany.args.select.createdById, undefined);
  assert.equal(findMany.args.select.description, undefined);
  assert.deepEqual(
    Object.keys(findMany.args.select).sort(),
    ["code", "createdAt", "discountType", "discountValue", "id", "isActive", "maxDiscount", "minPurchase", "usageLimit", "usedCount", "validFrom", "validUntil"],
  );
  assertReadOnly(calls);
});

test("page size bounds match the published contract", async () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => promoRow({ id: `promo-${index}` }));
  const capped = fakeClient({ promos: rows(60) });
  const cappedOutput = await listPromotionConfiguration({ limit: 100 }, { client: capped.client, principal: adminPrincipal(), cursorSecret: SECRET });
  assert.equal(cappedOutput.promotions.length, 50);
  assert.equal(capped.calls.at(0).args.take, 51);
  const floored = fakeClient({ promos: rows(5) });
  const flooredOutput = await listPromotionConfiguration({ limit: 0 }, { client: floored.client, principal: adminPrincipal(), cursorSecret: SECRET });
  assert.equal(flooredOutput.promotions.length, 1);
  await assert.rejects(
    listPromotionConfiguration({ limit: 1.5 }, { client: fakeClient().client, principal: adminPrincipal(), cursorSecret: SECRET }),
    { statusCode: 400 },
  );
});

test("activeOnly narrows the predicate and stays bound into the cursor", async () => {
  const { client, calls } = fakeClient({ promos: [promoRow(), promoRow({ id: "promo-2" })] });
  const first = await listPromotionConfiguration({ activeOnly: true, limit: 1 }, { client, principal: adminPrincipal(), cursorSecret: SECRET });
  assert.equal(calls.at(0).args.where.isActive, true);
  assert.ok(first.nextCursor);
  // Replaying the active-only cursor against an unfiltered query fails closed.
  await assert.rejects(
    listPromotionConfiguration({ cursor: first.nextCursor, limit: 1 }, { client, principal: adminPrincipal(), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.doesNotReject(
    listPromotionConfiguration({ cursor: first.nextCursor, activeOnly: true, limit: 1 }, { client, principal: adminPrincipal(), cursorSecret: SECRET }),
  );
});

test("cursors are bound to the admin principal", async () => {
  const rows = [promoRow({ id: "promo-b", createdAt: new Date("2026-08-30T00:00:00Z") }), promoRow({ id: "promo-a" })];
  const { client } = fakeClient({ promos: rows });
  const first = await listPromotionConfiguration({ limit: 1 }, { client, principal: adminPrincipal(), cursorSecret: SECRET });
  assert.ok(first.nextCursor);
  await assert.rejects(
    listPromotionConfiguration({ cursor: first.nextCursor, limit: 1 }, { client, principal: adminPrincipal(OTHER_ADMIN), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.rejects(
    listPromotionConfiguration({ cursor: first.nextCursor, limit: 1 }, { client, principal: adminPrincipal(), cursorSecret: "short" }),
    { statusCode: 503 },
  );
});

test("non-admin principals are denied with the generic not-found before any read", async () => {
  for (const principal of [sellerPrincipal, userPrincipal, undefined]) {
    const list = fakeClient({ promos: [promoRow()] });
    await assert.rejects(
      listPromotionConfiguration({}, { client: list.client, principal, cursorSecret: SECRET }),
      { statusCode: 404 },
    );
    const summary = fakeClient({ promos: [promoRow()] });
    await assert.rejects(
      getPromotionUsageSummary({ promoCodeId: PROMO_ID }, { client: summary.client, principal }),
      { statusCode: 404 },
    );
    assert.equal(list.calls.length, 0);
    assert.equal(summary.calls.length, 0);
  }
});

test("usage summary is aggregate-only and never reads usage rows back", async () => {
  const { client, calls } = fakeClient({
    promo: promoRow({ usedCount: 5 }),
    usageGroups: [{ userId: BUYER }, { userId: OTHER_ADMIN }, { userId: CREATOR_ID }],
  });
  const output = await getPromotionUsageSummary({ promoCodeId: PROMO_ID }, { client, principal: adminPrincipal() });
  const groupBy = calls.find((call) => call.model === "promoCodeUsage");
  assert.ok(groupBy, "usage count must go through groupBy");
  assert.equal(groupBy.method, "groupBy");
  assert.deepEqual(groupBy.args.by, ["userId"]);
  assert.deepEqual(groupBy.args.where, { promoCodeId: PROMO_ID });
  const findFirst = calls.find((call) => call.method === "findFirst");
  assert.deepEqual(
    Object.keys(findFirst.args.select).sort(),
    ["code", "id", "isActive", "usedCount", "validFrom", "validUntil"],
  );
  assert.equal(findFirst.args.select.createdById, undefined);
  assert.equal(output.totalRedemptions, 5);
  assert.equal(output.distinctUsers, 3);
  assert.equal(output.promoCodeId, PROMO_ID);
  assert.equal(output.code, "RLS10");
  assert.equal(output.active, true);
  assert.equal(output.validFrom, "2026-09-01T00:00:00.000Z");
  assert.equal(output.validUntil, "2026-12-31T00:00:00.000Z");
  // Aggregate-only: no findMany/findFirst on the usages table, ever.
  assert.ok(!calls.some((call) => call.model === "promoCodeUsage" && call.method !== "groupBy"));
  assertReadOnly(calls);
  // No per-user redemption data leaves the service.
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(BUYER));
  assert.ok(!serialized.includes(OTHER_ADMIN));
  assert.ok(!serialized.includes(CREATOR_ID));
  assert.ok(!serialized.toLowerCase().includes("userid"));
  assert.deepEqual(
    Object.keys(output).sort(),
    ["active", "code", "distinctUsers", "promoCodeId", "totalRedemptions", "validFrom", "validUntil"],
  );
});

test("missing and malformed promo ids resolve to the generic not-found", async () => {
  const missing = fakeClient({ promo: null });
  await assert.rejects(
    getPromotionUsageSummary({ promoCodeId: "does-not-exist" }, { client: missing.client, principal: adminPrincipal() }),
    { statusCode: 404 },
  );
  assert.deepEqual(missing.calls.at(0).args.where, { id: "does-not-exist" });
  for (const badId of ["", undefined, 12345]) {
    const untouched = fakeClient({ promo: promoRow() });
    await assert.rejects(
      getPromotionUsageSummary({ promoCodeId: badId }, { client: untouched.client, principal: adminPrincipal() }),
      { statusCode: 404 },
    );
    assert.equal(untouched.calls.length, 0);
  }
});

test("configuration money and percentages stay exact, bounded, and NPR-denominated", async () => {
  const { client, calls } = fakeClient({
    promos: [
      promoRow({
        discountType: "fixed",
        discountValue: "150.75",
        minPurchase: "100.00",
        maxDiscount: "50.00",
        usageLimit: 5,
      }),
      promoRow({ id: "promo-percent", discountValue: "12.50" }),
    ],
  });
  const output = await listPromotionConfiguration({}, { client, principal: adminPrincipal(), cursorSecret: SECRET });
  assert.deepEqual(output.promotions[0].discountValue, { amount: "150.75", currency: "NPR" });
  assert.deepEqual(output.promotions[0].minPurchase, { amount: "100", currency: "NPR" });
  assert.deepEqual(output.promotions[0].maxDiscount, { amount: "50", currency: "NPR" });
  assert.equal(output.promotions[0].usageLimit, 5);
  assert.deepEqual(output.promotions[1].discountValue, { percent: "12.5" });
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(CREATOR_ID));
  assert.ok(!serialized.includes("createdById"));
  assertReadOnly(calls);
});

test("stored configuration that violates the contract fails closed", async () => {
  const contractViolations = [
    promoRow({ discountType: "mystery" }),
    promoRow({ discountValue: "150.00" }),
  ];
  for (const row of contractViolations) {
    const { client } = fakeClient({ promos: [row] });
    await assert.rejects(
      listPromotionConfiguration({}, { client, principal: adminPrincipal(), cursorSecret: SECRET }),
      { message: "Invalid promotion configuration" },
    );
  }
  // Malformed decimals never parse into a money value at all.
  const { client } = fakeClient({ promos: [promoRow({ discountType: "fixed", discountValue: "0.001" })] });
  await assert.rejects(
    listPromotionConfiguration({}, { client, principal: adminPrincipal(), cursorSecret: SECRET }),
    { message: "Invalid money value" },
  );
});
