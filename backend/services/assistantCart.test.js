import assert from "node:assert/strict";
import test from "node:test";

import { getMyCart, previewCheckout, validatePromoCode } from "./assistantCart.js";

const SUBJECT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const principal = (subject = SUBJECT) => ({ subject, role: "user", clientId: "client-1", grantId: "grant-1" });

const product = (overrides = {}) => ({
  id: "p1",
  name: "Headphones",
  price: "100.00",
  images: ["https://img.test/h.png"],
  category: "Audio",
  discount: "10",
  quantity: 3,
  isArchived: false,
  options: [{ kind: "color", value: "Red", priceDelta: "5.00" }],
  ...overrides,
});

const cartRow = (items) => ({ id: "cart-1", userId: SUBJECT, items });

// Proxy client that records every model call and forbids all writes, so
// repeated-call purity is asserted structurally instead of by code inspection.
const readOnlyClient = (handlers, calls = []) => new Proxy({}, {
  get: (_, model) => new Proxy({}, {
    get: (_, method) => async (args) => {
      calls.push(`${model}.${method}`);
      if (!method.startsWith("find") && !method.startsWith("count")) {
        throw new Error(`write blocked: ${model}.${method}`);
      }
      return handlers[`${model}.${method}`]?.(args) ?? null;
    },
  }),
});

const cartClient = (items, calls = []) => readOnlyClient({
  "cart.findFirst": () => cartRow(items),
}, calls);

const item = (overrides = {}) => ({
  productId: "p1",
  quantity: 2,
  variants: { color: "Red" },
  product: product(),
  ...overrides,
});

test("cart read scopes to the buyer and uses exact server arithmetic", async () => {
  let where;
  const client = readOnlyClient({
    "cart.findFirst": (args) => { where = args.where; return cartRow([item()]); },
  });
  const output = await getMyCart({}, { client, principal: principal() });
  assert.equal(where.userId, SUBJECT);
  assert.deepEqual(Object.keys(output).sort(), ["discountTotal", "items", "subtotal", "total"]);
  const [line] = output.items;
  assert.deepEqual(Object.keys(line).sort(), ["availability", "images", "lineTotal", "name", "productId", "quantity", "unitPrice", "variants"]);
  // List unit 100 + 5 option delta = 105; 10% discount -> 94.50 each; qty 2.
  assert.deepEqual(line.unitPrice, { amount: "94.5", currency: "NPR" });
  assert.deepEqual(line.lineTotal, { amount: "189", currency: "NPR" });
  assert.deepEqual(output.subtotal, { amount: "210", currency: "NPR" });
  assert.deepEqual(output.total, { amount: "189", currency: "NPR" });
  assert.deepEqual(output.discountTotal, { amount: "21", currency: "NPR" });
});

test("cart items never expose seller, email, or ownership fields", async () => {
  const output = await getMyCart({}, { client: cartClient([item()]), principal: principal() });
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(OTHER));
  assert.ok(!serialized.includes("seller"));
  assert.ok(!serialized.includes("@"));
});

test("archived products are labelled unavailable and excluded from totals", async () => {
  const output = await getMyCart({}, {
    client: cartClient([item({ product: product({ isArchived: true }) })]),
    principal: principal(),
  });
  assert.equal(output.items[0].availability, "Unavailable");
  assert.deepEqual(output.total, { amount: "0", currency: "NPR" });
});

test("missing cart returns an empty projection with zero totals", async () => {
  const output = await getMyCart({}, { client: cartClient(null), principal: principal() });
  assert.deepEqual(output.items, []);
  assert.deepEqual(output.total, { amount: "0", currency: "NPR" });
});

const promo = (overrides = {}) => ({
  id: "promo-1",
  code: "SAVE10",
  description: "Ten off",
  discountType: "percentage",
  discountValue: "10",
  minPurchase: "50",
  maxDiscount: "30",
  usageLimit: 100,
  usedCount: 3,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validUntil: new Date("2026-12-31T00:00:00Z"),
  isActive: true,
  ...overrides,
});

const promoClient = ({ items = [item()], promoRow = promo(), used = null } = {}, calls = []) => readOnlyClient({
  "cart.findFirst": () => cartRow(items),
  "promoCode.findUnique": () => promoRow,
  "promoCodeUsage.findUnique": () => used,
}, calls);

test("promo validation is pure: repeated calls change no commerce state", async () => {
  const calls = [];
  const ctx = { client: promoClient({}, calls), principal: principal(), now: new Date("2026-06-01T00:00:00Z") };
  const first = await validatePromoCode({ code: "save10" }, ctx);
  const second = await validatePromoCode({ code: "SAVE10" }, ctx);
  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  // 10% of 189 subtotal... cart total 189 -> discount 18.9 capped by max 30.
  assert.deepEqual(first.discountAmount, { amount: "18.9", currency: "NPR" });
  assert.deepEqual(first.finalAmount, { amount: "170.1", currency: "NPR" });
  assert.ok(calls.every((call) => call.includes("find")));
  assert.ok(!calls.some((call) => /create|update|delete|upsert/i.test(call)));
});

test("promo validation reports stable reasons without consuming usage", async () => {
  const ctxFor = (promoRow, used = null) => ({
    client: promoClient({ promoRow, used }),
    principal: principal(),
    now: new Date("2026-06-01T00:00:00Z"),
  });
  assert.equal((await validatePromoCode({ code: "NOPE" }, ctxFor(null))).reason, "invalid");
  assert.equal((await validatePromoCode({ code: "X" }, ctxFor(promo({ isActive: false })))).reason, "inactive");
  assert.equal((await validatePromoCode({ code: "X" }, ctxFor(promo({ validUntil: new Date("2026-01-02T00:00:00Z") })))).reason, "expired");
  assert.equal((await validatePromoCode({ code: "X" }, ctxFor(promo(), { promoCodeId: "promo-1", userId: SUBJECT }))).reason, "already_used");
  assert.equal((await validatePromoCode({ code: "X" }, ctxFor(promo({ usageLimit: 3, usedCount: 3 })))).reason, "usage_limit");
  assert.equal((await validatePromoCode({ code: "X" }, ctxFor(promo({ minPurchase: "9999" })))).reason, "min_purchase");
});

test("fixed promo discounts never exceed the cart total", async () => {
  const ctx = {
    client: promoClient({ promoRow: promo({ discountType: "fixed", discountValue: "500", maxDiscount: null }) }),
    principal: principal(),
    now: new Date("2026-06-01T00:00:00Z"),
  };
  const output = await validatePromoCode({ code: "SAVE10" }, ctx);
  assert.deepEqual(output.discountAmount, { amount: "189", currency: "NPR" });
  assert.deepEqual(output.finalAmount, { amount: "0", currency: "NPR" });
});

test("checkout preview computes server totals and creates nothing", async () => {
  const calls = [];
  const ctx = { client: promoClient({}, calls), principal: principal(), now: new Date("2026-06-01T00:00:00Z") };
  const output = await previewCheckout({ promoCode: "SAVE10" }, ctx);
  assert.deepEqual(output.subtotal, { amount: "210", currency: "NPR" });
  assert.deepEqual(output.promoDiscount, { amount: "18.9", currency: "NPR" });
  assert.deepEqual(output.total, { amount: "170.1", currency: "NPR" });
  assert.equal(output.items.length, 1);
  assert.ok(calls.every((call) => call.includes("find")));
  assert.ok(!calls.some((call) => /create|update|delete|upsert|generate|reserve|payment|bill|notif|email/i.test(call)));
});

test("checkout preview without a promo code returns undiscounted server totals", async () => {
  const ctx = { client: promoClient({}), principal: principal(), now: new Date("2026-06-01T00:00:00Z") };
  const output = await previewCheckout({}, ctx);
  assert.deepEqual(output.promoDiscount, { amount: "0", currency: "NPR" });
  assert.deepEqual(output.total, { amount: "189", currency: "NPR" });
  assert.equal(output.promo, null);
});
