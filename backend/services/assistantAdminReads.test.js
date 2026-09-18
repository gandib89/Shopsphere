import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlatformRevenueSummary,
  listSellerApplications,
} from "./assistantAdminReads.js";

const ADMIN = "eeeeeeeeeeeeeeeeeeeeeeee";
const SELLER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "admin-reads-cursor-secret-that-is-at-least-32-bytes!";
const principal = (role = "admin", subject = ADMIN) => ({ subject, role, clientId: "client-1", grantId: "grant-1" });
const now = new Date("2026-09-18T10:00:00Z");

// Same opaque-reference derivation the service uses, spelled out so the test
// pins the exact digest domain string and length.
const sellerReferenceFor = (userId) =>
  `seller-${crypto.createHash("sha256").update(`shopsphere-seller:${userId}`).digest("hex").slice(0, 12)}`;

test("platform revenue summary aggregates the whole ledger with exact paisa math", async () => {
  const seen = { groupBy: [], aggregate: [] };
  const client = {
    revenue: {
      groupBy: async (args) => {
        seen.groupBy.push(args);
        return [
          { month: 1, _sum: { totalSalePrice: "1000.10", adminCommission: "50.00", sellerRevenue: "950.10" }, _count: { _all: 2 } },
          { month: 3, _sum: { totalSalePrice: "0.01", adminCommission: "0.00", sellerRevenue: "0.01" }, _count: { _all: 1 } },
          { month: null, _sum: { totalSalePrice: "999.99", adminCommission: "0", sellerRevenue: "0" }, _count: { _all: 1 } },
        ];
      },
    },
    refund: {
      aggregate: async (args) => {
        seen.aggregate.push(args);
        return { _sum: { amount: args.where.completedAt.gte.getMonth() === 0 ? "12.34" : null } };
      },
    },
  };
  const output = await getPlatformRevenueSummary({ year: 2026 }, { client, principal: principal(), now });
  // Platform-wide: no seller (or any per-seller) predicate narrows the ledger.
  assert.equal(seen.groupBy.length, 1);
  assert.deepEqual(seen.groupBy[0].where, { year: 2026, status: "Completed" });
  assert.deepEqual(seen.groupBy[0]._sum, { totalSalePrice: true, adminCommission: true, sellerRevenue: true });
  assert.equal(seen.aggregate.length, 12);
  for (const [index, args] of seen.aggregate.entries()) {
    assert.equal(args.where.status, "Succeeded");
    const start = args.where.completedAt.gte;
    const end = args.where.completedAt.lt;
    assert.equal(start.getMonth(), index);
    assert.equal(end.getTime() - start.getTime(), new Date(2026, index + 1, 1).getTime() - start.getTime());
  }
  assert.equal(output.buckets.length, 12);
  assert.deepEqual(output.buckets.map(({ month }) => month), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(output.buckets[0], {
    month: 1,
    completedSaleCount: 2,
    grossSale: { amount: "1000.1", currency: "NPR" },
    adminCommission: { amount: "50", currency: "NPR" },
    sellerRevenue: { amount: "950.1", currency: "NPR" },
    refunded: { amount: "12.34", currency: "NPR" },
  });
  assert.deepEqual(output.buckets[1], {
    month: 2,
    completedSaleCount: 0,
    grossSale: { amount: "0", currency: "NPR" },
    adminCommission: { amount: "0", currency: "NPR" },
    sellerRevenue: { amount: "0", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  });
  assert.deepEqual(output.buckets[2].grossSale, { amount: "0.01", currency: "NPR" });
  // Ledger rows without a usable month are excluded from buckets and totals.
  assert.deepEqual(output.totals, {
    completedSaleCount: 3,
    grossSale: { amount: "1000.11", currency: "NPR" },
    adminCommission: { amount: "50", currency: "NPR" },
    sellerRevenue: { amount: "950.11", currency: "NPR" },
    refunded: { amount: "12.34", currency: "NPR" },
  });
});

test("refunded money is reported separately and never netted against gross", async () => {
  const client = {
    revenue: {
      groupBy: async () => [
        { month: 5, _sum: { totalSalePrice: "100.00", adminCommission: "5.00", sellerRevenue: "95.00" }, _count: { _all: 1 } },
      ],
    },
    refund: { aggregate: async () => ({ _sum: { amount: "0.05" } }) },
  };
  const output = await getPlatformRevenueSummary({ year: 2026 }, { client, principal: principal(), now });
  assert.deepEqual(output.buckets[4].grossSale, { amount: "100", currency: "NPR" });
  assert.deepEqual(output.buckets[4].refunded, { amount: "0.05", currency: "NPR" });
  assert.deepEqual(output.totals.grossSale, { amount: "100", currency: "NPR" });
  assert.deepEqual(output.totals.refunded, { amount: "0.6", currency: "NPR" });
});

test("platform summary output exposes aggregates only — no raw rows or identity", async () => {
  const client = {
    revenue: { groupBy: async () => [] },
    refund: { aggregate: async () => ({ _sum: { amount: null } }) },
  };
  const output = await getPlatformRevenueSummary({ year: 2026 }, { client, principal: principal(), now });
  const serialized = JSON.stringify(output);
  for (const forbidden of ["orderId", "productId", "sellerId", "adminId", "email", "payment", "bank", "accountNumber"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.deepEqual(Object.keys(output), ["year", "buckets", "totals"]);
});

test("platform summary bounds the year, defaults to the current one, and demands an admin principal", async () => {
  const client = {
    revenue: { groupBy: async (args) => { throw Object.assign(new Error(String(args.where.year)), { statusCode: 500 }); } },
    refund: { aggregate: async () => ({ _sum: { amount: null } }) },
  };
  await assert.rejects(getPlatformRevenueSummary({ year: 1999 }, { client, principal: principal(), now }), { statusCode: 400 });
  await assert.rejects(getPlatformRevenueSummary({ year: 2101 }, { client, principal: principal(), now }), { statusCode: 400 });
  await assert.rejects(getPlatformRevenueSummary({}, { client, principal: principal(), now }), { message: "2026" });
  await assert.rejects(getPlatformRevenueSummary({ year: 2026 }, { client, principal: principal("seller"), now }), { statusCode: 403 });
  await assert.rejects(getPlatformRevenueSummary({ year: 2026 }, { client, principal: principal("user"), now }), { statusCode: 403 });
});

test("application list scopes rows to seller applications and selects only application columns", async () => {
  let where;
  let select;
  const client = {
    user: {
      findMany: async (args) => { where = args.where; select = args.select; return []; },
    },
  };
  await listSellerApplications({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.deepEqual(where, { role: "seller" });
  assert.deepEqual([...Object.keys(select)].sort(), [
    "createdAt",
    "id",
    "isVerified",
    "shopDescription",
    "shopName",
    "verificationApprovedDate",
    "verificationRejectionReason",
    "verificationRequestDate",
  ]);
  const serializedSelect = JSON.stringify(select);
  for (const forbidden of ["email", "firstName", "lastName", "phone", "home", "password", "resetToken"]) {
    assert.ok(!serializedSelect.includes(forbidden), forbidden);
  }
});

test("application status filters translate into exact predicates", async () => {
  const seen = [];
  const client = {
    user: { findMany: async (args) => { seen.push(args.where); return []; } },
  };
  await listSellerApplications({ status: "pending" }, { client, principal: principal(), cursorSecret: SECRET });
  await listSellerApplications({ status: "approved" }, { client, principal: principal(), cursorSecret: SECRET });
  await listSellerApplications({ status: "rejected" }, { client, principal: principal(), cursorSecret: SECRET });
  await assert.rejects(
    listSellerApplications({ status: "verified" }, { client, principal: principal(), cursorSecret: SECRET }),
    { statusCode: 400 },
  );
  assert.deepEqual(seen, [
    { role: "seller", isVerified: false, verificationRejectionReason: null },
    { role: "seller", isVerified: true },
    { role: "seller", isVerified: false, verificationRejectionReason: { not: null } },
  ]);
});

const applicationRow = (overrides = {}) => ({
  id: SELLER,
  shopName: "Ben's Shop",
  shopDescription: "Handmade goods",
  isVerified: false,
  verificationRequestDate: new Date("2026-08-01T08:00:00Z"),
  verificationApprovedDate: null,
  verificationRejectionReason: null,
  createdAt: new Date("2026-08-01T07:00:00Z"),
  ...overrides,
});

test("application output carries the opaque reference and derives status with decision metadata", async () => {
  const rows = [
    applicationRow(),
    applicationRow({
      id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      isVerified: true,
      verificationApprovedDate: new Date("2026-08-05T08:00:00Z"),
    }),
    applicationRow({
      id: "cccccccccccccccccccccccc",
      verificationRejectionReason: "Shop documents did not match the registered business name",
    }),
  ];
  const client = { user: { findMany: async () => rows } };
  const output = await listSellerApplications({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(output.applications.length, 3);
  const [pending, approved, rejected] = output.applications;
  assert.match(pending.sellerReference, /^seller-[0-9a-f]{12}$/);
  assert.equal(pending.sellerReference, sellerReferenceFor(SELLER));
  assert.equal(pending.status, "pending");
  assert.equal(pending.requestDate, "2026-08-01T08:00:00.000Z");
  assert.equal(pending.decisionDate, null);
  assert.equal(pending.rejectionReason, null);
  assert.equal(approved.status, "approved");
  assert.equal(approved.decisionDate, "2026-08-05T08:00:00.000Z");
  assert.equal(approved.rejectionReason, null);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.decisionDate, null);
  assert.equal(rejected.rejectionReason, "Shop documents did not match the registered business name");
  // No raw account ids and no private contact fields ever leave the service.
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(SELLER));
  assert.ok(!serialized.includes("@"));
  for (const forbidden of ["email", "firstName", "lastName", "phone", "homeStreet", "verificationRequestDate"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test("shop display fields and rejection reasons are sliced to the published bounds", async () => {
  const client = {
    user: {
      findMany: async () => [applicationRow({
        shopName: "N".repeat(300),
        shopDescription: "D".repeat(3000),
        verificationRejectionReason: "R".repeat(1000),
      })],
    },
  };
  const output = await listSellerApplications({ status: "rejected" }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(output.applications[0].shopName.length, 200);
  assert.equal(output.applications[0].shopDescription.length, 2000);
  assert.equal(output.applications[0].rejectionReason.length, 500);
});

test("application pages are bounded and the cursor is minted only when a page overflows", async () => {
  const seen = [];
  let call = 0;
  const client = {
    user: {
      findMany: async (args) => {
        seen.push(args);
        call += 1;
        const count = call === 2 ? 2 : args.take; // only the second page is complete
        return Array.from({ length: count }, (_, index) =>
          applicationRow({ id: String(index).padStart(24, "0"), createdAt: new Date(2026, 7, index + 1) }));
      },
    },
  };
  const overflowing = await listSellerApplications({ limit: 2 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(seen[0].take, 3);
  assert.equal(overflowing.applications.length, 2);
  assert.ok(overflowing.nextCursor);
  const complete = await listSellerApplications({ limit: 2 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(complete.applications.length, 2);
  assert.equal(complete.nextCursor, null);
  const overwide = await listSellerApplications({ limit: 500 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.equal(overwide.applications.length, 50);
  assert.equal(seen[2].take, 51);
});

test("application cursors are bound to the admin principal and fail closed without a secret", async () => {
  const rows = [
    applicationRow({ id: "111111111111111111111111", createdAt: new Date("2026-08-02T10:00:00Z") }),
    applicationRow({ id: "222222222222222222222222", createdAt: new Date("2026-08-01T10:00:00Z") }),
  ];
  const client = { user: { findMany: async () => rows } };
  const first = await listSellerApplications({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.ok(first.nextCursor);
  await assert.rejects(
    listSellerApplications({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal("admin", "ffffffffffffffffffffffff"), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.rejects(
    listSellerApplications({ cursor: `${first.nextCursor}tamper`, limit: 1 }, { client, principal: principal(), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
  await assert.rejects(
    listSellerApplications({ limit: 1 }, { client, principal: principal(), cursorSecret: "too-short" }),
    { statusCode: 503 },
  );
});

test("application list demands an admin principal", async () => {
  const client = { user: { findMany: async () => [] } };
  await assert.rejects(listSellerApplications({}, { client, principal: principal("seller"), cursorSecret: SECRET }), { statusCode: 403 });
  await assert.rejects(listSellerApplications({}, { client, principal: principal("user"), cursorSecret: SECRET }), { statusCode: 403 });
});
