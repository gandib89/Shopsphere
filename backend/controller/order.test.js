import assert from "node:assert/strict";
import test from "node:test";

import { adjustStock, updateFirstRevenueByOrder } from "./order.js";

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

test("adjustStock returns null when the product no longer exists", async () => {
  const client = { product: { findUnique: async () => null } };
  const result = await adjustStock("missing", 1, null, null, -1, client);
  assert.equal(result, null);
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
