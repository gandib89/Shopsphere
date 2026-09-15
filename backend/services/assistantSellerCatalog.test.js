import assert from "node:assert/strict";
import test from "node:test";

import {
  getMyInventorySummary,
  getMyProduct,
  listMyProducts,
} from "./assistantSellerCatalog.js";

const SELLER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RIVAL = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "seller-cursor-secret-that-is-at-least-thirty-two-bytes!";
const principal = (subject = SELLER) => ({ subject, role: "seller", clientId: "client-1", grantId: "grant-1" });

const productRow = (overrides = {}) => ({
  id: "prod-1",
  sellerId: SELLER,
  name: "Headphones",
  price: "100.00",
  quantity: 12,
  category: "Audio",
  description: "Great sound",
  images: ["https://img.test/h.png"],
  discount: "5",
  isArchived: false,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  options: [{ kind: "color", value: "Red", priceDelta: "5.00", stock: 4 }],
  ...overrides,
});

test("product list scopes to the seller and keeps archived products visible to their owner", async () => {
  let where;
  const client = {
    product: {
      findMany: async (args) => { where = args.where; return [productRow(), productRow({ id: "prod-2", isArchived: true })]; },
    },
  };
  const output = await listMyProducts({}, { client, principal: principal(), cursorSecret: SECRET });
  assert.deepEqual(where, { sellerId: SELLER });
  assert.equal(output.products.length, 2);
  assert.deepEqual(output.products[1], {
    id: "prod-2",
    name: "Headphones",
    price: { amount: "100", currency: "NPR" },
    quantity: 12,
    category: "Audio",
    isArchived: true,
  });
  assert.ok(!JSON.stringify(output).includes("sellerId"));
});

test("product cursors are bound to the selling principal", async () => {
  const rows = [
    productRow({ id: "prod-2", createdAt: new Date("2026-09-02T10:00:00Z") }),
    productRow({ id: "prod-1", createdAt: new Date("2026-09-01T10:00:00Z") }),
  ];
  const client = { product: { findMany: async () => rows } };
  const first = await listMyProducts({ limit: 1 }, { client, principal: principal(), cursorSecret: SECRET });
  assert.ok(first.nextCursor);
  await assert.rejects(
    listMyProducts({ cursor: first.nextCursor, limit: 1 }, { client, principal: principal(RIVAL), cursorSecret: SECRET }),
    { statusCode: 404 },
  );
});

test("product detail denies another seller's private fields with generic not-found", async () => {
  let where;
  const client = {
    product: {
      findFirst: async (args) => { where = args.where; return null; },
    },
  };
  await assert.rejects(getMyProduct({ productId: "rival-prod" }, { client, principal: principal() }), { statusCode: 404 });
  assert.deepEqual(where, { id: "rival-prod", sellerId: SELLER });
});

test("product detail projects exact option stock without customer data", async () => {
  const client = { product: { findFirst: async () => productRow() } };
  const output = await getMyProduct({ productId: "prod-1" }, { client, principal: principal() });
  assert.deepEqual(output.options, [{ kind: "color", value: "Red", priceDelta: { amount: "5", currency: "NPR" }, stock: 4 }]);
  assert.deepEqual(output.price, { amount: "100", currency: "NPR" });
  assert.equal(output.discount, "5");
  assert.equal(output.quantity, 12);
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes("sellerId") && !serialized.includes("order") && !serialized.includes("revenue"));
});

test("inventory summary aggregates only owned products under a bounded threshold", async () => {
  const calls = [];
  const client = {
    product: {
      count: async (args) => { calls.push(["count", args.where]); return 2; },
      aggregate: async (args) => { calls.push(["aggregate", args.where]); return { _sum: { quantity: 15 } }; },
      findMany: async (args) => {
        calls.push(["findMany", args.where]);
        assert.ok(args.where.quantity.lte <= 50);
        return [productRow({ id: "prod-9", name: "Cable", quantity: 2 })];
      },
    },
  };
  const output = await getMyInventorySummary({ threshold: 5 }, { client, principal: principal() });
  assert.deepEqual(output, {
    threshold: 5,
    totalProducts: 2,
    totalUnits: 15,
    lowStockCount: 1,
    lowStock: [{ productId: "prod-9", name: "Cable", quantity: 2 }],
  });
  for (const [, where] of calls) assert.equal(where.sellerId, SELLER);
});

test("inventory threshold is server-bounded and competitor stock never leaks", async () => {
  let usedTake;
  const client = {
    product: {
      count: async () => 0,
      aggregate: async () => ({ _sum: { quantity: null } }),
      findMany: async (args) => { usedTake = args.take; return []; },
    },
  };
  const output = await getMyInventorySummary({ threshold: 5000 }, { client, principal: principal() });
  assert.equal(output.threshold, 50);
  assert.ok(usedTake <= 50);
  assert.deepEqual(output.lowStock, []);
});

test("seller reads do not depend on historical order attribution", async () => {
  // Catalog scoping uses present-day Product.sellerId only: no order, revenue,
  // or sellerIdAtPurchase lookup may appear in the catalog query path.
  const seen = [];
  const client = {
    product: {
      findMany: async (args) => { seen.push(args); return []; },
      findFirst: async (args) => { seen.push(args); return null; },
      count: async (args) => { seen.push(args); return 0; },
      aggregate: async (args) => { seen.push(args); return { _sum: { quantity: 0 } }; },
    },
  };
  await listMyProducts({}, { client, principal: principal(), cursorSecret: SECRET });
  await assert.rejects(getMyProduct({ productId: "x" }, { client, principal: principal() }), { statusCode: 404 });
  await getMyInventorySummary({}, { client, principal: principal() });
  const serialized = JSON.stringify(seen);
  assert.ok(!serialized.includes("sellerIdAtPurchase"));
  assert.ok(!serialized.includes("revenue"));
  assert.ok(!serialized.includes("orderGroupId"));
  assert.ok(seen.every((args) => !("order" in (args.where ?? {})) && !("orders" in (args.select ?? {}))));
});
