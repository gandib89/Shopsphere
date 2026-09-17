import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyOwnership,
  isQuarantined,
  buildBuyerOrderWhere,
  buildSellerOrderWhere,
  buildSellerStorefrontWhere,
  resolveSellerIdAtPurchase,
} from "./orderOwnership.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

// ─── quarantine rules ─────────────────────────────────────────────────────────
test("null buyer rows are quarantined from assistant reads", () => {
  assert.equal(isQuarantined({ userId: null, productSellerId: "s1" }), true);
  assert.equal(classifyOwnership({ userId: null, productSellerId: "s1" }).reason, "null_buyer");
});

test("null seller rows are quarantined, not claimed", () => {
  const verdict = classifyOwnership({ userId: "u1", productSellerId: null, revenueSellerIds: [] });
  assert.equal(verdict.quarantined, true);
  assert.equal(verdict.reason, "null_seller");
});

test("conflicting revenue seller quarantines the row", () => {
  const verdict = classifyOwnership({ userId: "u1", productSellerId: "s1", revenueSellerIds: ["s2"] });
  assert.equal(verdict.quarantined, true);
  assert.equal(verdict.reason, "conflicting_seller");
});

test("ambiguous rows (two revenue sellers) are quarantined", () => {
  const verdict = classifyOwnership({ userId: "u1", productSellerId: "s1", revenueSellerIds: ["s1", "s2"] });
  assert.equal(verdict.quarantined, true);
  assert.equal(verdict.reason, "ambiguous_seller");
});

test("trustworthy legacy rows are repairable with the product owner", () => {
  const verdict = classifyOwnership({ userId: "u1", productSellerId: "s1", revenueSellerIds: [] });
  assert.equal(verdict.quarantined, false);
  assert.equal(verdict.backfillSellerId, "s1");
});

test("trustworthy rows with agreeing revenue are repairable", () => {
  const verdict = classifyOwnership({ userId: "u1", productSellerId: "s1", revenueSellerIds: ["s1"] });
  assert.equal(verdict.quarantined, false);
  assert.equal(verdict.backfillSellerId, "s1");
});

test("repaired rows keep a conflicting later product owner quarantined, not adopted", () => {
  // Product transferred s1 -> s2 after purchase; attribution still s1 with a
  // contradicting revenue write is conflicting, never silently re-owned.
  const verdict = classifyOwnership({
    userId: "u1",
    sellerIdAtPurchase: "s1",
    productSellerId: "s2",
    revenueSellerIds: ["s2"],
  });
  assert.equal(verdict.quarantined, true);
});

// ─── historical transfer: sale attribution is immutable ───────────────────────
test("historical transfer keeps sale attribution with the original seller", () => {
  const order = { id: "o1", sellerIdAtPurchase: "s1" };
  // Current owner changed s1 -> s2; attribution must not follow.
  assert.equal(resolveSellerIdAtPurchase(order, "s2"), "s1");
  assert.deepEqual(buildSellerOrderWhere("s1"), { sellerIdAtPurchase: "s1" });
  // Assistant read for the new owner does not match the old sale.
  assert.deepEqual(buildSellerOrderWhere("s2"), { sellerIdAtPurchase: "s2" });
});

test("new orders snapshot the seller; multi-seller group children differ per child", () => {
  assert.equal(resolveSellerIdAtPurchase({}, "sA"), "sA");
  assert.equal(resolveSellerIdAtPurchase({ sellerIdAtPurchase: "sA" }, "sB"), "sA");
  const groupChildren = [{ sellerIdAtPurchase: "sA" }, { sellerIdAtPurchase: "sB" }];
  const sellerA = groupChildren.filter((c) => (buildSellerOrderWhere("sA").sellerIdAtPurchase === c.sellerIdAtPurchase));
  assert.equal(sellerA.length, 1); // one seller never sees the whole group
});

test("buyer assistant scope uses verified userId, never email", () => {
  assert.deepEqual(buildBuyerOrderWhere("u1"), { userId: "u1" });
  assert.ok(!("email" in buildBuyerOrderWhere("u1")));
});

test("seller assistant scope is immutable attribution only (legacy rows excluded)", () => {
  const where = buildSellerOrderWhere("s1");
  assert.deepEqual(where, { sellerIdAtPurchase: "s1" });
  assert.ok(!("OR" in where)); // no present-day product-owner fallback here
});

test("storefront fallback still shows pre-backfill rows via product owner", () => {
  const where = buildSellerStorefrontWhere("s1");
  assert.ok(where.OR.some((c) => c.sellerIdAtPurchase === "s1"));
  assert.ok(where.OR.some((c) => c.sellerIdAtPurchase === null));
});

// ─── migration / rollback / indexes (PG16-shape, file-level) ──────────────────
test("forward migration adds immutable attribution, FK, and supporting indexes", () => {
  const sql = read("../prisma/migrations/20260914000000_order_ownership_attribution/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "sellerIdAtPurchase"/);
  assert.match(sql, /orders_sellerIdAtPurchase_fkey/);
  assert.match(sql, /orders_userId_createdAt_idx/);
  assert.match(sql, /orders_sellerIdAtPurchase_createdAt_idx/);
  assert.match(sql, /products_sellerId_idx/);
  assert.match(sql, /ON DELETE SET NULL/);
});

test("rollback reverses the forward migration without touching legacy columns", () => {
  const sql = read("../prisma/migrations/20260914000000_order_ownership_attribution/rollback.sql");
  assert.match(sql, /DROP COLUMN IF EXISTS "sellerIdAtPurchase"/);
  assert.match(sql, /DROP INDEX IF EXISTS "orders_sellerIdAtPurchase_createdAt_idx"/);
  assert.match(sql, /DROP INDEX IF EXISTS "orders_userId_createdAt_idx"/);
  assert.match(sql, /DROP INDEX IF EXISTS "products_sellerId_idx"/);
  assert.ok(!sql.includes("DROP COLUMN") || !sql.match(/DROP COLUMN IF EXISTS "(userId|email)"/));
});

test("schema declares the attribution relation and supporting indexes", () => {
  const schema = read("../prisma/schema.prisma");
  assert.match(schema, /sellerIdAtPurchase\s+String\?\s+@db\.VarChar\(24\)/);
  assert.match(schema, /OrderSellerAtPurchase/);
  assert.match(schema, /@@index\(\[userId, createdAt\]\)/);
  assert.match(schema, /@@index\(\[sellerIdAtPurchase, createdAt\]\)/);
  assert.match(schema, /@@index\(\[sellerId\]\)/);
});
