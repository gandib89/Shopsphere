import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublicProduct,
  searchPublicProducts,
} from "./assistantPublicCatalog.js";

const cursorSecret = "cursor-test-secret-123456789012345";
const products = [
  {
    id: "p1",
    name: "Phone",
    price: { toString: () => "999.99" },
    images: ["phone.jpg"],
    category: "Phones",
    quantity: 2,
  },
  {
    id: "p2",
    name: "Phone Pro",
    price: { toString: () => "1299.00" },
    images: ["phone-pro.jpg"],
    category: "Phones",
    quantity: 0,
  },
];

test("search projects exact money and issues query-bound opaque cursors", async () => {
  let captured;
  const client = {
    product: {
      findMany: async (args) => {
        captured = args;
        return products.slice(args.skip, args.skip + args.take);
      },
      count: async () => products.length,
    },
  };
  const first = await searchPublicProducts(
    { q: "phone", sort: "price-asc", limit: 1 },
    { client, cursorSecret },
  );
  assert.deepEqual(first.items[0].price, { amount: "999.99", currency: "NPR" });
  assert.equal(first.items[0].availability, "In stock");
  assert.ok(first.nextCursor && !first.nextCursor.includes("phone"));
  assert.deepEqual(captured.select, {
    id: true,
    name: true,
    price: true,
    images: true,
    category: true,
    quantity: true,
  });

  const second = await searchPublicProducts(
    { q: "phone", sort: "price-asc", limit: 1, cursor: first.nextCursor },
    { client, cursorSecret },
  );
  assert.equal(second.items[0].id, "p2");
  await assert.rejects(
    searchPublicProducts(
      { q: "different-query", sort: "price-asc", limit: 1, cursor: first.nextCursor },
      { client, cursorSecret },
    ),
    /invalid cursor/i,
  );
});

test("product detail selects only public fields and exact option deltas", async () => {
  let captured;
  const client = {
    product: {
      findFirst: async (args) => {
        captured = args;
        return {
          ...products[0],
          description: "A phone",
          variantColor: ["Black"],
          variantStorage: ["128GB"],
          options: [{ kind: "storage", value: "256GB", priceDelta: { toString: () => "100.00" } }],
        };
      },
    },
  };
  const result = await getPublicProduct({ productId: "p1" }, { client });
  assert.deepEqual(result.variants.options[0].priceDelta, { amount: "100.00", currency: "NPR" });
  assert.equal(captured.where.isArchived, false);
  assert.equal(captured.select.sellerId, undefined);
  assert.equal(captured.select.quantity, true);
  assert.doesNotMatch(JSON.stringify(result), /"sellerId"|"stock"|"quantity"/);
});
