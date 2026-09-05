import test from "node:test";
import assert from "node:assert/strict";
import { optionPriceDelta, listPriceWithOptions, effectiveProductPrice } from "./productPricing.js";

const product = {
  price: 124999,
  discount: 0,
  options: [
    { kind: "storage", value: "128GB", priceDelta: 0 },
    { kind: "storage", value: "256GB", priceDelta: 15000 },
    { kind: "color", value: "Black", priceDelta: 0 },
  ],
};

test("adds the delta of every chosen option", () => {
  assert.equal(optionPriceDelta(product, { storage: "256GB" }), 15000);
  assert.equal(optionPriceDelta(product, { storage: "256GB", color: "Black" }), 15000);
  assert.equal(listPriceWithOptions(product, { storage: "256GB" }), 139999);
});

test("unknown or missing selections never change the price", () => {
  assert.equal(optionPriceDelta(product, { storage: "1TB" }), 0);
  assert.equal(optionPriceDelta(product, {}), 0);
  assert.equal(optionPriceDelta(product, undefined), 0);
  assert.equal(optionPriceDelta({ price: 100 }, { storage: "256GB" }), 0);
  assert.equal(listPriceWithOptions(product, undefined), 124999);
});

test("discount applies to the configured price, not the base price", () => {
  assert.equal(effectiveProductPrice({ ...product, discount: 10 }, { storage: "256GB" }), 125999.1);
  assert.equal(effectiveProductPrice(product, { storage: "256GB" }), 139999);
  assert.equal(effectiveProductPrice({ price: 1000, discount: 15 }), 850);
});
