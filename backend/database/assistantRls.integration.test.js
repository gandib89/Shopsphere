import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const actorA = { actorId: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "user", operation: "profile.getMySummary" };
const actorB = { actorId: "bbbbbbbbbbbbbbbbbbbbbbbb", role: "seller", operation: "profile.getMySummary" };
const projection = { id: true, firstName: true, lastName: true, role: true, isVerified: true };

test("restricted PostgreSQL role and transaction-local RLS isolate assistant reads", { skip: !enabled }, async (t) => {
  t.after(() => assistantPrisma.$disconnect());

  const [attributes] = await assistantPrisma.$queryRawUnsafe(`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolbypassrls,
           current_user AS current_user
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  assert.deepEqual(attributes, {
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolbypassrls: false,
    current_user: "shopsphere_assistant_runtime",
  });
  const [privileges] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'users', 'firstName', 'SELECT') AS profile_read,
      has_column_privilege(current_user, 'users', 'email', 'SELECT') AS email_read,
      has_table_privilege(current_user, 'orders', 'SELECT') AS orders_read,
      has_column_privilege(current_user, 'orders', 'email', 'SELECT') AS order_email_read,
      has_column_privilege(current_user, 'orders', 'status', 'SELECT') AS order_status_read,
      has_column_privilege(current_user, 'carts', 'email', 'SELECT') AS cart_email_read,
      has_column_privilege(current_user, 'carts', 'totalPrice', 'SELECT') AS cart_total_read,
      has_column_privilege(current_user, 'cart_items', 'variants', 'SELECT') AS cart_item_variants_read,
      has_column_privilege(current_user, 'bills', 'deliveryStreet', 'SELECT') AS bill_address_read,
      has_column_privilege(current_user, 'bills', 'totalPrice', 'SELECT') AS bill_total_read,
      has_column_privilege(current_user, 'payments', 'gatewayRefId', 'SELECT') AS payment_gateway_read,
      has_column_privilege(current_user, 'payments', 'amount', 'SELECT') AS payment_amount_read,
      has_column_privilege(current_user, 'refunds', 'providerRefundId', 'SELECT') AS refund_provider_read,
      has_column_privilege(current_user, 'promo_codes', 'code', 'SELECT') AS promo_code_read,
      has_column_privilege(current_user, 'promo_codes', 'createdById', 'SELECT') AS promo_creator_read,
      has_column_privilege(current_user, 'products', 'discount', 'SELECT') AS product_discount_read,
      has_column_privilege(current_user, 'products', 'sellerId', 'SELECT') AS product_seller_read,
      has_column_privilege(current_user, 'product_options', 'stock', 'SELECT') AS option_stock_read,
      has_column_privilege(current_user, 'product_options', 'id', 'SELECT') AS option_id_read
  `);
  assert.deepEqual(privileges, {
    profile_read: true,
    email_read: false,
    orders_read: true,
    order_email_read: false,
    order_status_read: true,
    cart_email_read: false,
    cart_total_read: true,
    cart_item_variants_read: true,
    bill_address_read: false,
    bill_total_read: true,
    payment_gateway_read: false,
    payment_amount_read: true,
    refund_provider_read: false,
    promo_code_read: true,
    promo_creator_read: false,
    product_discount_read: true,
    product_seller_read: true,
    option_stock_read: true,
    option_id_read: false,
  });
  const [newPrivileges] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'notifications', 'title', 'SELECT') AS notification_read,
      has_column_privilege(current_user, 'notifications', 'productImage', 'SELECT') AS notification_image_read,
      has_table_privilege(current_user, 'assistant_audit_events', 'INSERT') AS audit_insert,
      has_table_privilege(current_user, 'assistant_audit_events', 'UPDATE') AS audit_update
  `);
  assert.deepEqual(newPrivileges, {
    notification_read: true,
    notification_image_read: false,
    audit_insert: true,
    audit_update: false,
  });
  const [rls] = await assistantPrisma.$queryRawUnsafe(`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'users'::regclass
  `);
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  const rlsTables = await assistantPrisma.$queryRawUnsafe(`
    SELECT relname AS table_name, relrowsecurity AS rls, relforcerowsecurity AS force
    FROM pg_class
    WHERE oid IN ('carts'::regclass, 'cart_items'::regclass, 'orders'::regclass, 'bills'::regclass,
                  'payments'::regclass, 'refunds'::regclass, 'promo_codes'::regclass, 'promo_code_usages'::regclass)
  `);
  assert.equal(rlsTables.length, 8);
  for (const table of rlsTables) assert.deepEqual(table, { ...table, rls: true, force: true });
  // The RLS seed owns one seller product; the catalog shares this role without
  // actor context, so the count stays visible while private rows stay scoped.
  assert.deepEqual(await assistantPrisma.product.count({ select: { id: true } }), { id: 1 });

  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);
  assert.deepEqual(await assistantPrisma.notification.findMany({ select: { id: true } }), []);
  const rowsA = await withAssistantActor(actorA, async (tx) => {
    const [context] = await tx.$queryRawUnsafe(`
      SELECT current_setting('shopsphere.actor_id', true) AS actor,
             current_setting('shopsphere.operation', true) AS operation
    `);
    assert.deepEqual(context, { actor: actorA.actorId, operation: actorA.operation });
    return tx.user.findMany({ select: projection }); // deliberately no ownership predicate
  });
  assert.deepEqual(rowsA.map(({ id }) => id), [actorA.actorId]);
  await assert.rejects(
    withAssistantActor(actorA, (tx) => tx.user.findMany({ select: { email: true } })),
    /permission denied|database query/i,
  );

  await assert.rejects(withAssistantActor(actorA, async (tx) => {
    assert.equal((await tx.user.findMany({ select: projection })).length, 1);
    throw new Error("force rollback");
  }), /force rollback/);
  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);

  const notificationsA = await withAssistantActor(
    { ...actorA, operation: "notifications.listMine" },
    (tx) => tx.notification.findMany({ select: { id: true, title: true } }),
  );
  assert.deepEqual(notificationsA, [{ id: "111111111111111111111111", title: "Ada notice" }]);
  assert.deepEqual(await assistantPrisma.notification.findMany({ select: { id: true } }), []);

  const rowsB = await withAssistantActor(actorB, (tx) => tx.user.findMany({ select: projection }));
  assert.deepEqual(rowsB.map(({ id }) => id), [actorB.actorId]);
  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);

  const controller = new AbortController();
  await assert.rejects(withAssistantActor({ ...actorA, signal: controller.signal }, async (tx) => {
    await tx.user.findMany({ select: projection });
    controller.abort();
  }), { name: "AbortError" });
  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);

  await assert.rejects(
    withAssistantActor({ ...actorA, timeoutMs: 100 }, (tx) => tx.$queryRawUnsafe("SELECT pg_sleep(1)")),
    /timeout|canceling statement|transaction/i,
  );
  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);

  // Buyer/seller reads (#12/#13/#14): ownership predicates plus RLS isolate
  // tenants; legacy NULL-buyer rows and NULL-userId bills stay quarantined.
  const buyerOrders = { ...actorA, operation: "orders.listMine" };
  const adaOrders = await withAssistantActor(buyerOrders, (tx) => tx.order.findMany({ select: { id: true } }));
  assert.deepEqual(adaOrders.map(({ id }) => id).sort(), ["f3f3f3f3f3f3f3f3f3f3f3f3"]);
  const buyerB = { actorId: "cccccccccccccccccccccccc", role: "user", operation: "orders.listMine" };
  const cidOrders = await withAssistantActor(buyerB, (tx) => tx.order.findMany({ select: { id: true } }));
  assert.deepEqual(cidOrders.map(({ id }) => id).sort(), ["b5b5b5b5b5b5b5b5b5b5b5b5"]);
  await assert.rejects(
    withAssistantActor(buyerOrders, (tx) => tx.order.findMany({ select: { email: true } })),
    /permission denied|database query/i,
  );

  const cartOp = { ...actorA, operation: "cart.getMine" };
  const adaCarts = await withAssistantActor(cartOp, (tx) => tx.cart.findMany({ select: { id: true } }));
  assert.deepEqual(adaCarts.map(({ id }) => id), ["e2e2e2e2e2e2e2e2e2e2e2e2"]);
  assert.deepEqual(await assistantPrisma.cart.findMany({ select: { id: true } }), []);

  const billOp = { ...actorA, operation: "orders.getMyBillSummary" };
  const adaBills = await withAssistantActor(billOp, (tx) => tx.bill.findMany({ select: { billNumber: true } }));
  assert.deepEqual(adaBills.map(({ billNumber }) => billNumber), ["BILL-f3f3f3f3f3f3f3f3f3f3f3f3"]);

  const paymentOp = { ...actorA, operation: "orders.getMyPaymentStatus" };
  const adaPayments = await withAssistantActor(paymentOp, (tx) => tx.payment.findMany({ select: { status: true } }));
  assert.deepEqual(adaPayments.map(({ status }) => status), ["Succeeded"]);
  await assert.rejects(
    withAssistantActor(paymentOp, (tx) => tx.payment.findMany({ select: { gatewayRefId: true } })),
    /permission denied|database query/i,
  );

  const promoOp = { ...actorA, operation: "cart.validatePromo" };
  const promos = await withAssistantActor(promoOp, (tx) => tx.promoCode.findMany({ select: { code: true } }));
  assert.ok(promos.some(({ code }) => code === "RLS10"));
  const adaUsage = await withAssistantActor(promoOp, (tx) => tx.promoCodeUsage.findMany({ select: { promoCodeId: true } }));
  assert.deepEqual(adaUsage.map(({ promoCodeId }) => promoCodeId), ["f9f9f9f9f9f9f9f9f9f9f9f9"]);
  const cidUsage = await withAssistantActor({ ...buyerB, operation: "cart.validatePromo" }, (tx) => tx.promoCodeUsage.findMany({ select: { promoCodeId: true } }));
  assert.deepEqual(cidUsage, []);
});
