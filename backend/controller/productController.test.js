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
