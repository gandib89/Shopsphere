import assert from "node:assert/strict";
import test from "node:test";

import {
  getMySale,
  getMyRevenueSummary,
  listMySales,
} from "./assistantSellerOrders.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const BUYER = "cccccccccccccccccccccccc";
const SECRET = "seller-cursor-secret-that-is-at-least-thirty-two-bytes!";
const principal = (subject = SELLER) => ({ subject, role: "seller", clientId: "client-1", grantId: "grant-1" });
const now = new Date("2026-09-18T10:00:00Z");

const saleRow = (overrides = {}) => ({
  id: "order-1",
  status: "Confirmed",
  quantity: 2,
  totalPrice: "100.00",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  orderGroupId: "group-1",
  userId: BUYER,
  productId: "prod-1",
  product: { name: "Headphones" },
  ...overrides,
});

const detailRow = (overrides = {}) => ({
  ...saleRow(),
  confirmedAt: new Date("2026-09-01T11:00:00Z"),
  processingAt: null,
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  variantStorage: "256GB",
  variantColor: "Red",
  variantRam: null,
  variantScreenSize: null,
  variantProcessor: null,
  ...overrides,
});

test("sale list authorizes through seller-at-purchase attribution only", async () => {
  let where;
  let select;
  const client = {
    order: {
      findMany: async (args) => { where = args.where; select = args.select; return [saleRow()]; },
    },
  };
  const output = await listMySales({}, { client, principal: principal(), cursorSecret: SECRET, now });
  assert.deepEqual([...Object.keys(where)].sort(), ["createdAt", "sellerIdAtPurchase"]);
  assert.equal(where.sellerIdAtPurchase, SELLER);
  assert.ok(!("sellerId" in where));
  assert.ok(!("product" in where) || !("sellerId" in where.product));
  assert.ok(select && !("email" in select) && !("firstName" in select) && !("lastName" in select));
  assert.equal(output.sales.length, 1);
});

test("historical transfer keeps the sale with the purchase-time seller", async () => {
  // The scope predicate must be the immutable attribution column, never a
  // present-day Product.sellerId join or the storefront fallback OR-branch.
  let where;
  const client = {
    order: {
      findMany: async (args) => { where = args.where; return [saleRow()]; },
    },
  };
  await listMySales({}, { client, principal: principal(), cursorSecret: SECRET, now });
  const serialized = JSON.stringify(where);
  assert.ok(serialized.includes("sellerIdAtPurchase"));
  assert.ok(!serialized.includes("OR"));
});

test("legacy null-attribution rows are quarantined from sale reads", async () => {
  // An exact sellerIdAtPurchase equality can never match NULL rows: the
  // quarantine falls out of the predicate shape itself.
  let where;
  const client = {
    order: {
      findMany: async (args) => { where = args.where; return []; },
    },
  };
  await listMySales({ status: "Confirmed" }, { client, principal: principal(), cursorSecret: SECRET, now });
  assert.equal(where.sellerIdAtPurchase, SELLER);
  assert.equal(where.status, "Confirmed");
});

test("unknown statuses and over-wide date ranges are rejected", async () => {
  const client = { order: { findMany: async () => [] } };
  const ctx = { client, principal: principal(), cursorSecret: SECRET, now };
  await assert.rejects(listMySales({ status: "Bogus" }, ctx), { statusCode: 400 });
  await assert.rejects(
    listMySales({ from: "2026-01-01T00:00:00Z", to: "2026-06-30T00:00:00Z" }, ctx),
    { statusCode: 400 },
  );
  // The refund-release terminal state is a filterable sale status.
  await assert.doesNotReject(listMySales({ status: "Refund Released" }, ctx));
});

test("buyer identity leaves only as a stable opaque reference", async () => {
  const client = {
    order: { findMany: async () => [saleRow({ userId: BUYER }), saleRow({ id: "order-2", userId: null })] },
  };
  const output = await listMySales({}, { client, principal: principal(), cursorSecret: SECRET, now });
  assert.match(output.sales[0].buyerReference, /^buyer-[0-9a-f]{12}$/);
  const again = await listMySales({}, { client, principal: principal(), cursorSecret: SECRET, now });
  assert.equal(again.sales[0].buyerReference, output.sales[0].buyerReference);
  assert.equal(output.sales[1].buyerReference, null);
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(BUYER));
  assert.ok(!serialized.includes("email") && !serialized.includes("firstName"));
});

test("sale cursors are bound to the selling principal", async () => {
  const rows = [
    saleRow({ id: "order-2", createdAt: new Date("2026-09-02T10:00:00Z") }),
    saleRow({ id: "order-1" }),
  ];
  const client = { order: { findMany: async () => rows } };
  const first = await listMySales({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET, now });
  assert.ok(first.nextCursor);
  await assert.rejects(
    listMySales({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal(RIVAL), cursorSecret: SECRET, now }),
    { statusCode: 404 },
  );
});

test("sale detail denies foreign ids with generic not-found", async () => {
  let where;
  const client = {
    order: { findFirst: async (args) => { where = args.where; return null; } },
  };
  await assert.rejects(getMySale({ orderId: "rival-order" }, { client, principal: principal() }), { statusCode: 404 });
  assert.deepEqual(where, { id: "rival-order", sellerIdAtPurchase: SELLER });
});

test("sale detail re-scopes group children to the same seller attribution", async () => {
  const client = {
    order: {
      findFirst: async () => detailRow(),
      findMany: async (args) => {
        assert.deepEqual(args.where, { sellerIdAtPurchase: SELLER, orderGroupId: "group-1", id: { not: "order-1" } });
        return [saleRow({ id: "order-3", productId: "prod-rival" })];
      },
    },
    revenue: { findFirst: async () => null },
  };
  const output = await getMySale({ orderId: "order-1" }, { client, principal: principal() });
  assert.equal(output.sale.variants.storage, "256GB");
  assert.equal(output.sale.confirmedAt, "2026-09-01T11:00:00.000Z");
  assert.equal(output.sale.revenue, null);
  assert.equal(output.groupSales.length, 1);
});

test("sale detail projects the stored ledger entry with exact money", async () => {
  let revenueWhere;
  const client = {
    order: { findFirst: async () => detailRow(), findMany: async () => [] },
    revenue: {
      findFirst: async (args) => {
        revenueWhere = args.where;
        return { status: "Completed", totalSalePrice: "100.00", adminCommission: "5.00", sellerRevenue: "95.00" };
      },
    },
  };
  const output = await getMySale({ orderId: "order-1" }, { client, principal: principal() });
  assert.deepEqual(revenueWhere, { orderId: "order-1", sellerId: SELLER });
  assert.deepEqual(output.sale.revenue, {
    status: "Completed",
    grossSale: { amount: "100", currency: "NPR" },
    commission: { amount: "5", currency: "NPR" },
    netSale: { amount: "95", currency: "NPR" },
  });
});

test("revenue summary returns exactly twelve buckets with explicit semantics", async () => {
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
  const output = await getMyRevenueSummary({ year: 2026 }, { client, principal: principal(), now });
  assert.equal(seen.groupBy.length, 1);
  assert.deepEqual(seen.groupBy[0].where, { sellerId: SELLER, year: 2026, status: "Completed" });
  assert.equal(seen.aggregate.length, 12);
  for (const [index, args] of seen.aggregate.entries()) {
    assert.equal(args.where.status, "Succeeded");
    assert.deepEqual(args.where.order, { sellerIdAtPurchase: SELLER });
    const start = args.where.completedAt.gte;
    const end = args.where.completedAt.lt;
    assert.equal(start.getMonth(), index);
    assert.equal(end.getTime() - start.getTime(), new Date(2026, index + 1, 1).getTime() - start.getTime());
  }
  assert.equal(output.buckets.length, 12);
  assert.deepEqual(output.buckets.map(({ month }) => month), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(output.buckets[0], {
    month: 1,
    saleCount: 2,
    grossSale: { amount: "1000.1", currency: "NPR" },
    commission: { amount: "50", currency: "NPR" },
    netSale: { amount: "950.1", currency: "NPR" },
    refunded: { amount: "12.34", currency: "NPR" },
  });
  assert.deepEqual(output.buckets[1], {
    month: 2,
    saleCount: 0,
    grossSale: { amount: "0", currency: "NPR" },
    commission: { amount: "0", currency: "NPR" },
    netSale: { amount: "0", currency: "NPR" },
    refunded: { amount: "0", currency: "NPR" },
  });
  assert.deepEqual(output.buckets[2].grossSale, { amount: "0.01", currency: "NPR" });
  // Ledger rows without a usable month are excluded from buckets and totals.
  assert.deepEqual(output.totals, {
    saleCount: 3,
    grossSale: { amount: "1000.11", currency: "NPR" },
    commission: { amount: "50", currency: "NPR" },
    netSale: { amount: "950.11", currency: "NPR" },
    refunded: { amount: "12.34", currency: "NPR" },
  });
});

test("revenue summary bounds the year and defaults to the current one", async () => {
  const client = {
    revenue: { groupBy: async (args) => { throw Object.assign(new Error(String(args.where.year)), { statusCode: 500 }); } },
    refund: { aggregate: async () => ({ _sum: { amount: null } }) },
  };
  await assert.rejects(getMyRevenueSummary({ year: 1999 }, { client, principal: principal(), now }), { statusCode: 400 });
  await assert.rejects(getMyRevenueSummary({ year: 2101 }, { client, principal: principal(), now }), { statusCode: 400 });
  await assert.rejects(getMyRevenueSummary({}, { client, principal: principal(), now }), { message: "2026" });
});

test("refund bucket money stays exact at paisa boundaries", async () => {
  const client = {
    revenue: { groupBy: async () => [] },
    refund: {
      aggregate: async () => ({ _sum: { amount: "0.05" } }),
    },
  };
  const output = await getMyRevenueSummary({ year: 2026 }, { client, principal: principal(), now });
  assert.deepEqual(output.buckets[4].refunded, { amount: "0.05", currency: "NPR" });
  assert.deepEqual(output.totals.refunded, { amount: "0.6", currency: "NPR" });
});
