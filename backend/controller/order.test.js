import assert from "node:assert/strict";
import test from "node:test";

import { adjustStock, cancelOrderCore, isCancelEligible, updateFirstRevenueByOrder, resolveServerPromoDiscount, redeemServerPromoDiscount, canTransitionOrderStatus, effectiveProductPrice } from "./order.js";

test("order status transitions only move forward through fulfilment", () => {
  assert.equal(canTransitionOrderStatus("Confirmed", "Processing"), true);
  assert.equal(canTransitionOrderStatus("Processing", "Shipped"), true);
  assert.equal(canTransitionOrderStatus("Shipped", "Delivered"), true);
  assert.equal(canTransitionOrderStatus("Pending", "Delivered"), false);
  assert.equal(canTransitionOrderStatus("Delivered", "Pending"), false);
  assert.equal(canTransitionOrderStatus("Cancelled", "Processing"), false);
});

test("checkout uses the product discount shown in the cart", () => {
  assert.equal(effectiveProductPrice({ price: 1000, discount: 15 }), 850);
  assert.equal(effectiveProductPrice({ price: 999.99, discount: 10 }), 899.99);
  assert.equal(effectiveProductPrice({ price: 1000, discount: 0 }), 1000);
});

const createFakeStockPrisma = (product) => {
  const store = { product: { ...product }, colorVariants: [...(product.colorVariants || [])], storageVariants: [...(product.storageVariants || [])] };
  return {
    store,
    product: {
      findUnique: async () => ({ ...store.product, colorVariants: store.colorVariants, storageVariants: store.storageVariants }),
      update: async ({ data }) => {
        if (data.quantity?.increment !== undefined) store.product.quantity += data.quantity.increment;
        return { ...store.product };
      },
      // Mirrors Prisma's conditional updateMany: only applies (and counts) when the row
      // still matches `where` — this is what makes adjustStock's floor guard testable.
      updateMany: async ({ where, data }) => {
        const meetsFloor = where.quantity?.gte === undefined || store.product.quantity >= where.quantity.gte;
        if (!meetsFloor) return { count: 0 };
        if (data.quantity?.increment !== undefined) store.product.quantity += data.quantity.increment;
        return { count: 1 };
      },
    },
    productColorVariant: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        store.colorVariants = store.colorVariants.map((cv) => {
          if (cv.color !== where.color) return cv;
          count += 1;
          return { ...cv, stock: cv.stock + (data.stock?.increment || 0) };
        });
        return { count };
      },
    },
    productStorageVariant: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        store.storageVariants = store.storageVariants.map((sv) => {
          if (sv.storage !== where.storage) return sv;
          count += 1;
          return { ...sv, stock: sv.stock + (data.stock?.increment || 0) };
        });
        return { count };
      },
    },
  };
};

test("adjustStock deducts base quantity plus the selected color/storage variant", async () => {
  const client = createFakeStockPrisma({
    id: "p1",
    quantity: 10,
    colorVariants: [{ color: "Black", stock: 4 }, { color: "White", stock: 6 }],
    storageVariants: [{ storage: "128GB", stock: 3 }],
  });

  const updated = await adjustStock("p1", 2, "Black", "128GB", -1, client);

  assert.equal(updated.quantity, 8);
  assert.equal(client.store.colorVariants.find((c) => c.color === "Black").stock, 2);
  assert.equal(client.store.colorVariants.find((c) => c.color === "White").stock, 6); // untouched
  assert.equal(client.store.storageVariants.find((s) => s.storage === "128GB").stock, 1);
});

test("adjustStock with sign=1 restores stock (cancel/return path)", async () => {
  const client = createFakeStockPrisma({ id: "p1", quantity: 5, colorVariants: [], storageVariants: [] });

  const updated = await adjustStock("p1", 3, null, null, 1, client);

  assert.equal(updated.quantity, 8);
});

test("adjustStock refuses to deduct past zero (oversell guard)", async () => {
  const client = createFakeStockPrisma({ id: "p1", quantity: 1, colorVariants: [], storageVariants: [] });

  const result = await adjustStock("p1", 2, null, null, -1, client);

  assert.equal(result, null);
  assert.equal(client.store.product.quantity, 1); // untouched — no partial deduction
});

test("adjustStock returns null when the product no longer exists", async () => {
  const client = { product: { findUnique: async () => null } };
  const result = await adjustStock("missing", 1, null, null, -1, client);
  assert.equal(result, null);
});

const createCancellationClient = (initialStatus) => {
  const state = {
    order: {
      id: "o1", userId: "u1", productId: "p1", quantity: 2,
      status: initialStatus, variantColor: null, variantStorage: null,
      product: { id: "p1", quantity: initialStatus === "Confirmed" ? 8 : 10, colorVariants: [], storageVariants: [] },
    },
  };
  const client = {
    state,
    order: {
      findUnique: async () => ({ ...state.order, product: { ...state.order.product } }),
      updateMany: async ({ where, data }) => {
        if (state.order.status !== where.status || (where.userId && state.order.userId !== where.userId)) return { count: 0 };
        Object.assign(state.order, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(state.order, data);
        return { ...state.order, product: { ...state.order.product } };
      },
    },
    product: {
      findUnique: async () => ({ ...state.order.product, colorVariants: [], storageVariants: [] }),
      update: async ({ data }) => {
        state.order.product.quantity += data.quantity.increment;
        return { ...state.order.product };
      },
    },
    productColorVariant: { updateMany: async () => ({ count: 0 }) },
    productStorageVariant: { updateMany: async () => ({ count: 0 }) },
  };
  client.$transaction = async (fn) => fn(client);
  return client;
};

test("cancellation eligibility is independently callable without side effects", () => {
  assert.equal(isCancelEligible("Pending"), true);
  assert.equal(isCancelEligible("Confirmed"), true);
  assert.equal(isCancelEligible("Shipped"), false);
  assert.equal(isCancelEligible("Cancelled"), false);
  assert.equal(isCancelEligible({ status: "Pending" }), true);
  assert.equal(isCancelEligible({ status: "Delivered" }), false);
});

test("cancelling an unpaid Pending order does not restore stock", async () => {
  const client = createCancellationClient("Pending");
  const result = await cancelOrderCore("o1", "u1", client);
  assert.equal(result.order.status, "Cancelled");
  assert.equal(result.stockRestored, false);
  assert.equal(result.refundRequired, null);
  assert.equal(result.moneyMoved, false);
  assert.equal(client.state.order.product.quantity, 10);
});

test("cancelling a Confirmed order restores stock exactly once", async () => {
  const client = createCancellationClient("Confirmed");
  const first = await cancelOrderCore("o1", "u1", client);
  assert.equal(first.stockRestored, true);
  assert.equal(first.refundRequired, "human");
  assert.equal(first.moneyMoved, false);
  assert.equal(client.state.order.product.quantity, 10);
  await assert.rejects(cancelOrderCore("o1", "u1", client), (error) => error.statusCode === 409);
  assert.equal(client.state.order.product.quantity, 10);
});

test("a paid cancellation never calls a refund provider and reports human handling", async () => {
  const client = createCancellationClient("Confirmed");
  // If cancel ever touches money, these fakes fail loudly.
  client.refund = { create: async () => { throw new Error("cancel must not create a Refund row"); } };
  let providerCalls = 0;
  const provider = { refund: async () => { providerCalls += 1; return { status: "Succeeded" }; } };
  const result = await cancelOrderCore("o1", "u1", client);
  assert.equal(result.order.status, "Cancelled");
  assert.equal(result.stockRestored, true);
  assert.equal(result.refundRequired, "human");
  assert.equal(result.moneyMoved, false);
  assert.equal(providerCalls, 0);
  // No Refund row shape was produced by the state transition.
  assert.equal(result.refund, undefined);
});

test("cancelOrderCore requires an explicit transaction client (no global fallback)", async () => {
  await assert.rejects(cancelOrderCore("o1", "u1"), (error) => error.statusCode === 500);
});

test("cancelOrderCore accepts a raw transaction client without $transaction", async () => {
  const client = createCancellationClient("Pending");
  const tx = { ...client };
  delete tx.$transaction;
  const result = await cancelOrderCore("o1", "u1", tx);
  assert.equal(result.order.status, "Cancelled");
  assert.equal(result.moneyMoved, false);
});

test("concurrent cancellations can claim and restore a Confirmed order only once", async () => {
  const client = createCancellationClient("Confirmed");
  const results = await Promise.allSettled([
    cancelOrderCore("o1", "u1", client),
    cancelOrderCore("o1", "u1", client),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
  assert.equal(client.state.order.product.quantity, 10);
  const winner = results.find((result) => result.status === "fulfilled").value;
  assert.equal(winner.refundRequired, "human");
  assert.equal(winner.moneyMoved, false);
});

test("an admin can cancel a customer's order through the shared cancellation workflow", async () => {
  const client = createCancellationClient("Pending");
  const result = await cancelOrderCore("o1", { id: "admin1", role: "admin" }, client);
  assert.equal(result.order.status, "Cancelled");
  assert.equal(result.stockRestored, false);
  assert.equal(result.refundRequired, null);
  assert.equal(result.moneyMoved, false);
});

const createFakeRevenuePrisma = (rows) => ({
  rows,
  revenue: {
    findFirst: async ({ where }) => rows.find((r) => r.orderId === where.orderId) || null,
    update: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
  },
});

test("updateFirstRevenueByOrder updates only the first matching row", async () => {
  const rows = [{ id: "r1", orderId: "o1", status: "Pending" }, { id: "r2", orderId: "o1", status: "Pending" }];
  const client = createFakeRevenuePrisma(rows);

  const updated = await updateFirstRevenueByOrder("o1", { status: "Completed" }, client);

  assert.equal(updated.status, "Completed");
  assert.equal(rows[0].status, "Completed");
  assert.equal(rows[1].status, "Pending"); // second row for the same order is untouched
});

test("updateFirstRevenueByOrder returns null when no revenue row exists for the order", async () => {
  const client = createFakeRevenuePrisma([]);
  const result = await updateFirstRevenueByOrder("no-such-order", { status: "Completed" }, client);
  assert.equal(result, null);
});

// ─── resolveServerPromoDiscount ───────────────────────────────────────────────
// Guards against the price-manipulation bug where checkout used to trust a client-sent
// discountAmount directly instead of recomputing it from the stored PromoCode row.
const createFakePromoPrisma = (promo) => ({
  promoCode: {
    findUnique: async () => (promo ? { ...promo } : null),
  },
});

const activePromo = (overrides = {}) => ({
  id: "promo1",
  code: "SAVE10",
  discountType: "percentage",
  discountValue: 10,
  minPurchase: 0,
  maxDiscount: null,
  usageLimit: null,
  usedCount: 0,
  isActive: true,
  validFrom: new Date(Date.now() - 86400000),
  validUntil: new Date(Date.now() + 86400000),
  ...overrides,
});

test("resolveServerPromoDiscount ignores an unknown code instead of trusting the caller", async () => {
  const client = createFakePromoPrisma(null);
  const result = await resolveServerPromoDiscount("MADEUP", 1000, client);
  assert.deepEqual(result, { discountAmount: 0, code: null });
});

test("resolveServerPromoDiscount recomputes a percentage discount from the stored promo, not the caller", async () => {
  const client = createFakePromoPrisma(activePromo());
  const result = await resolveServerPromoDiscount("save10", 1000, client);
  assert.equal(result.code, "SAVE10");
  assert.equal(result.discountAmount, 100); // 10% of 1000 — never whatever a client might claim
});

test("resolveServerPromoDiscount caps a percentage discount at maxDiscount", async () => {
  const client = createFakePromoPrisma(activePromo({ maxDiscount: 50 }));
  const result = await resolveServerPromoDiscount("SAVE10", 1000, client);
  assert.equal(result.discountAmount, 50);
});

test("resolveServerPromoDiscount rejects an expired promo", async () => {
  const client = createFakePromoPrisma(activePromo({ validUntil: new Date(Date.now() - 1000) }));
  const result = await resolveServerPromoDiscount("SAVE10", 1000, client);
  assert.deepEqual(result, { discountAmount: 0, code: null });
});

test("resolveServerPromoDiscount rejects a promo that already hit its usage limit", async () => {
  const client = createFakePromoPrisma(activePromo({ usageLimit: 5, usedCount: 5 }));
  const result = await resolveServerPromoDiscount("SAVE10", 1000, client);
  assert.deepEqual(result, { discountAmount: 0, code: null });
});

test("resolveServerPromoDiscount ignores a client-forged discountAmount by recomputing a fixed discount too", async () => {
  const client = createFakePromoPrisma(activePromo({ discountType: "fixed", discountValue: 5000 }));
  // Even if a caller claimed a much larger discountAmount, the fixed discount is capped at
  // the purchase amount itself — never a client-supplied number.
  const result = await resolveServerPromoDiscount("SAVE10", 1000, client);
  assert.equal(result.discountAmount, 1000);
});

test("promo redemption is recorded server-side and cannot be reused by the same user", async () => {
  const promo = activePromo();
  const usages = new Set();
  const client = {
    promoCode: {
      findUnique: async () => ({ ...promo }),
      updateMany: async () => { promo.usedCount += 1; return { count: 1 }; },
    },
    promoCodeUsage: {
      findUnique: async ({ where }) => usages.has(`${where.promoCodeId_userId.promoCodeId}:${where.promoCodeId_userId.userId}`) ? {} : null,
      create: async ({ data }) => { usages.add(`${data.promoCodeId}:${data.userId}`); return data; },
    },
  };
  client.$transaction = async (operation) => operation(client);

  const first = await redeemServerPromoDiscount("SAVE10", 1000, "user1", client);
  const second = await redeemServerPromoDiscount("SAVE10", 1000, "user1", client);

  assert.equal(first.discountAmount, 100);
  assert.deepEqual(second, { discountAmount: 0, code: null });
  assert.equal(promo.usedCount, 1);
});
