import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import { prisma } from "./prismaClient.js";
import { getMyInventorySummary, getMyProduct, listMyProducts } from "../services/assistantSellerCatalog.js";
import { getMyRevenueSummary, getMySale, listMySales } from "../services/assistantSellerOrders.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const seller = "bbbbbbbbbbbbbbbbbbbbbbbb";
const competitor = "eeeeeeeeeeeeeeeeeeeeeeee";
const ownProduct = "d1d1d1d1d1d1d1d1d1d1d1d1";
const archivedProduct = "d3d3d3d3d3d3d3d3d3d3d3d3";
const transferredProduct = "d2d2d2d2d2d2d2d2d2d2d2d2";
const historicalSale = "f4f4f4f4f4f4f4f4f4f4f4f4";
const competitorSale = "f5f5f5f5f5f5f5f5f5f5f5f5";
const cursorSecret = "seller-release-test-cursor-secret-32-characters";
const principal = (subject, overrides = {}) => ({
  subject, role: "seller", clientId: "shopsphere-mcp-client", grantId: "seller-release-grant", ...overrides,
});
const read = (subject, operation, fn) => withAssistantActor(
  { actorId: subject, role: "seller", operation }, fn,
);
const snapshot = async () => {
  const result = {};
  for (const table of ["products", "product_options", "orders", "revenues", "refunds", "payments", "bills", "carts", "cart_items"]) {
    const [row] = await prisma.$queryRawUnsafe(`
      SELECT md5(coalesce(json_agg(t ORDER BY t.id)::text, '[]')) AS digest
      FROM ${table} t
    `);
    result[table] = row.digest;
  }
  return result;
};

test("seller release: PostgreSQL RLS, historical attribution, privacy, and read purity", { skip: !enabled }, async (t) => {
  t.after(async () => { await assistantPrisma.$disconnect(); await prisma.$disconnect(); });
  const before = await snapshot();
  const ben = principal(seller);
  const cara = principal(competitor);
  assert.equal(await prisma.user.count({ where: { id: { in: [seller, competitor] }, role: "seller", isVerified: true } }), 2);
  assert.equal(await prisma.user.count({ where: { id: "ffffffffffffffffffffffff", role: "seller", isVerified: false } }), 1);

  const benCatalog = await read(seller, "products.listMine", (tx) =>
    listMyProducts({}, { client: tx, principal: ben, cursorSecret }));
  assert.deepEqual(benCatalog.products.map(({ id }) => id).sort(), [archivedProduct, ownProduct].sort());
  assert.equal(benCatalog.products.find(({ id }) => id === archivedProduct).isArchived, true);
  assert.ok(!benCatalog.products.some(({ id }) => id === transferredProduct));
  const caraCatalog = await read(competitor, "products.listMine", (tx) =>
    listMyProducts({}, { client: tx, principal: cara, cursorSecret }));
  assert.ok(caraCatalog.products.some(({ id }) => id === transferredProduct));
  assert.ok(!caraCatalog.products.some(({ id }) => id === ownProduct));

  const page = await read(seller, "products.listMine", (tx) =>
    listMyProducts({ limit: 1 }, { client: tx, principal: ben, cursorSecret }));
  assert.ok(page.nextCursor);
  for (const deniedPrincipal of [cara, principal(seller, { clientId: "other-client" }),
    principal(seller, { grantId: "other-grant" })]) {
    await assert.rejects(read(seller, "products.listMine", (tx) =>
      listMyProducts({ limit: 1, cursor: page.nextCursor },
        { client: tx, principal: deniedPrincipal, cursorSecret })), { statusCode: 404 });
  }
  await assert.rejects(read(seller, "products.listMine", (tx) =>
    listMyProducts({ limit: 2, cursor: page.nextCursor },
      { client: tx, principal: ben, cursorSecret })), { statusCode: 404 });

  const ownDetail = await read(seller, "products.getMine", (tx) =>
    getMyProduct({ productId: ownProduct }, { client: tx, principal: ben }));
  assert.equal(ownDetail.options.find(({ value }) => value === "Red")?.stock, 4);
  await assert.rejects(read(seller, "products.getMine", (tx) =>
    getMyProduct({ productId: transferredProduct }, { client: tx, principal: ben })),
  { statusCode: 404 });
  const inventory = await read(seller, "products.getMyInventorySummary", (tx) =>
    getMyInventorySummary({}, { client: tx, principal: ben }));
  assert.equal(inventory.totalProducts, 2);
  assert.equal(inventory.totalUnits, 9);
  assert.equal(inventory.lowStockCount, 1);
  assert.deepEqual(inventory.lowStock.map(({ productId }) => productId), [archivedProduct]);

  const benSales = await read(seller, "sales.listMine", (tx) =>
    listMySales({}, { client: tx, principal: ben, cursorSecret }));
  assert.ok(benSales.sales.some(({ id }) => id === historicalSale));
  assert.ok(!benSales.sales.some(({ id }) => id === competitorSale));
  const sale = await read(seller, "sales.getMine", (tx) =>
    getMySale({ orderId: historicalSale }, { client: tx, principal: ben }));
  assert.equal(sale.sale.productId, transferredProduct);
  assert.deepEqual(sale.groupSales.map(({ id }) => id), ["f6f6f6f6f6f6f6f6f6f6f6f6"]);
  await assert.rejects(read(seller, "sales.getMine", (tx) =>
    getMySale({ orderId: competitorSale }, { client: tx, principal: ben })), { statusCode: 404 });

  const [benRevenue, caraRevenue] = await Promise.all([
    read(seller, "sales.revenueSummary", (tx) => getMyRevenueSummary({ year: 2026 }, { client: tx, principal: ben })),
    read(competitor, "sales.revenueSummary", (tx) => getMyRevenueSummary({ year: 2026 }, { client: tx, principal: cara })),
  ]);
  assert.equal(benRevenue.buckets.length, 12);
  assert.equal(benRevenue.totals.saleCount, 1);
  assert.equal(benRevenue.totals.grossSale.amount, "49.99");
  const [refundLedger] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(r.amount), 0)::text AS amount
    FROM refunds r JOIN orders o ON o.id = r."orderId"
    WHERE o."sellerIdAtPurchase" = ${seller} AND r.status = 'Succeeded'
      AND r."completedAt" >= '2026-01-01'::timestamp
      AND r."completedAt" < '2027-01-01'::timestamp
  `;
  assert.equal(Number(benRevenue.totals.refunded.amount), Number(refundLedger.amount));
  assert.ok(Number(benRevenue.totals.refunded.amount) >= 39.99);
  assert.equal(caraRevenue.totals.saleCount, 1);
  assert.equal(caraRevenue.totals.grossSale.amount, "39.99");
  assert.equal(caraRevenue.totals.refunded.amount, "0");

  const outputs = [benCatalog, caraCatalog, ownDetail, inventory, benSales, sale, benRevenue, caraRevenue];
  const serialized = JSON.stringify(outputs);
  for (const canary of ["CANARY-BUYER-NAME-32", "canary-buyer-email-32@example.test", "CANARY-BUYER-ADDRESS-32"])
    assert.ok(!serialized.includes(canary));
  assert.ok(!serialized.includes("rls-foreign-option-32"));

  // Deliberately omit application owner predicates: policy weakening must
  // cause these assertions to fail even if the services remain scoped.
  const [benOrderIds, caraOrderIds, benRevenueIds] = await Promise.all([
    read(seller, "sales.listMine", (tx) => tx.order.findMany({
      where: { orderGroupId: "rls-mixed-seller-group-32" }, select: { id: true },
    })),
    read(competitor, "sales.listMine", (tx) => tx.order.findMany({
      where: { orderGroupId: "rls-mixed-seller-group-32" }, select: { id: true },
    })),
    read(seller, "sales.revenueSummary", (tx) => tx.revenue.findMany({ select: { id: true } })),
  ]);
  assert.deepEqual(benOrderIds.map(({ id }) => id).sort(), [historicalSale, "f6f6f6f6f6f6f6f6f6f6f6f6"].sort());
  assert.deepEqual(caraOrderIds.map(({ id }) => id), [competitorSale]);
  assert.deepEqual(benRevenueIds.map(({ id }) => id).sort(), ["a2a2a2a2a2a2a2a2a2a2a2a2", "a5a5a5a5a5a5a5a5a5a5a5a5"]);
  await assert.rejects(read(seller, "sales.listMine", (tx) => tx.order.findMany({ select: { email: true } })),
    /permission denied|database query/i);
  await assert.rejects(read(seller, "products.getMine", (tx) => tx.product.update({
    where: { id: ownProduct }, data: { quantity: 999 }, select: { id: true },
  })), /permission denied|database query/i);
  await assert.rejects(read(seller, "sales.getMine", async (tx) => {
    await tx.order.findMany({ select: { id: true } });
    throw new Error("forced seller rollback");
  }), /forced seller rollback/);
  await assert.rejects(withAssistantActor(
    { actorId: seller, role: "seller", operation: "sales.listMine", timeoutMs: 100 },
    (tx) => tx.$queryRawUnsafe("SELECT pg_sleep(1)"),
  ), /timeout|canceling statement|transaction/i);
  // A later request on the pool must see only its own seller, even after
  // a failed transaction and a timed-out transaction released connections.
  assert.deepEqual(await read(competitor, "sales.listMine", (tx) => tx.order.findMany({
    where: { orderGroupId: "rls-mixed-seller-group-32" }, select: { id: true },
  })), [{ id: competitorSale }]);
  assert.deepEqual(await assistantPrisma.order.findMany({ select: { id: true } }), []);

  for (let repeat = 0; repeat < 2; repeat += 1) {
    await Promise.all([
      read(seller, "products.listMine", (tx) => listMyProducts({}, { client: tx, principal: ben, cursorSecret })),
      read(competitor, "sales.listMine", (tx) => listMySales({}, { client: tx, principal: cara, cursorSecret })),
      read(seller, "sales.revenueSummary", (tx) => getMyRevenueSummary({ year: 2026 }, { client: tx, principal: ben })),
    ]);
  }
  assert.deepEqual(await snapshot(), before);
  process.stdout.write(`SHOPSPHERE_SELLER_POSTGRES_EVIDENCE=${JSON.stringify({
    issue: 32, mode: "postgres", outcome: "pass",
    tools: ["list_my_products", "get_my_product", "get_my_inventory_summary",
      "list_my_seller_orders", "get_my_seller_order", "get_my_revenue_summary"],
    checks: ["verified_and_unverified_fixture", "archived_and_foreign_catalog",
      "private_stock_and_inventory", "historical_and_grouped_sales", "revenue_and_refunds",
      "cursor_binding", "negative_rls_and_read_purity", "pooled_cleanup"]
      .map((name) => ({ name, outcome: "pass" })),
  })}\n`);
});
