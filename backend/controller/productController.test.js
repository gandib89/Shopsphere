import assert from "node:assert/strict";
import test from "node:test";

import * as productController from "./productController.js";

test("formats Prisma product IDs for legacy storefront navigation", () => {
  assert.equal(typeof productController.formatProductResponse, "function");

  const response = productController.formatProductResponse({
    id: "66a200000000000000000003",
    name: "iPhone 16",
    category: "Mobile Phones",
    images: ["/images/iphone16.png"],
  });

  assert.deepEqual(response, {
    id: "66a200000000000000000003",
    _id: "66a200000000000000000003",
    name: "iPhone 16",
    category: "Mobile Phones",
    images: ["/images/iphone16.png"],
  });
});

test("formats recommendation arrays for product-card actions", () => {
  assert.equal(typeof productController.formatRecommendedProducts, "function");

  const recommendations = productController.formatRecommendedProducts([
    {
      id: "66a200000000000000000001",
      name: "iPhone 17",
      category: "Mobile Phones",
      images: ["/images/iphone17.jpg"],
      metrics: { support: 0.2, confidence: 0.8, lift: 1.4 },
    },
  ]);

  assert.equal(recommendations[0]._id, "66a200000000000000000001");
  assert.deepEqual(recommendations[0].metrics, {
    support: 0.2,
    confidence: 0.8,
    lift: 1.4,
  });
});

test("seller product read is scoped to the signed-in seller", async () => {
  const result = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const req = { params: { id: "66a200000000000000000003" }, user: { id: "seller-a", role: "seller" } };

  let where;
  const found = result();
  await productController.getSellerProductById(req, found, {
    product: { findFirst: async (args) => { where = args.where; return { id: req.params.id, name: "iPhone 16", category: "Mobile Phones", sellerId: "seller-a" }; } },
  });
  assert.deepEqual(where, { id: "66a200000000000000000003", sellerId: "seller-a" });
  assert.equal(found.statusCode, 200);
  assert.equal(found.body._id, "66a200000000000000000003");

  // Another seller's product must not leak — the sellerId filter makes it a plain 404.
  const other = result();
  await productController.getSellerProductById(req, other, { product: { findFirst: async () => null } });
  assert.equal(other.statusCode, 404);
  assert.equal(other.body.message, "Product not found");
});

test("admin product creation assigns the selected seller", async () => {
  const sellerId = "66a100000000000000000001";
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let createdData;
  const client = {
    user: {
      findUnique: async ({ where }) => where.id === sellerId ? { id: sellerId, role: "seller" } : null,
      findMany: async () => [],
    },
    product: {
      create: async ({ data }) => {
        createdData = data;
        return { ...data, colorVariants: [], storageVariants: [], options: [], reviews: [] };
      },
    },
    notification: { createMany: async () => ({ count: 0 }) },
  };

  await productController.createAdminSellerProduct({
    params: { sellerId },
    body: { name: "Admin-listed MacBook", price: 120000, quantity: 3, images: ["/uploads/macbook.jpg"], category: "MacBook" },
  }, res, client);

  assert.equal(res.statusCode, 201);
  assert.equal(createdData.sellerId, sellerId);
  assert.equal(res.body.product.name, "Admin-listed MacBook");
});

test("admin product creation rejects a non-seller target", async () => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let created = false;
  await productController.createAdminSellerProduct({
    params: { sellerId: "66a100000000000000000009" },
    body: { name: "Should not exist", price: 10, quantity: 1, images: ["/uploads/test.jpg"], category: "Accessories" },
  }, res, {
    user: { findUnique: async () => ({ id: "66a100000000000000000009", role: "user" }) },
    product: { create: async () => { created = true; } },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Seller not found");
  assert.equal(created, false);
});
