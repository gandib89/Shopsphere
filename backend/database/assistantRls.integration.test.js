import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import test from "node:test";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { assistantPrisma, assistantPublicPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import { prisma } from "./prismaClient.js";
import { requestContext } from "../middlewares/requestContext.js";
import { getAssistantRedis } from "../services/assistantRedis.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const actorA = { actorId: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "user", operation: "profile.getMySummary" };
const actorB = { actorId: "bbbbbbbbbbbbbbbbbbbbbbbb", role: "seller", operation: "profile.getMySummary" };
const projection = { id: true, firstName: true, lastName: true, role: true, isVerified: true };

test("restricted PostgreSQL role and transaction-local RLS isolate assistant reads", { skip: !enabled }, async (t) => {
  t.after(async () => {
    await assistantPrisma.$disconnect();
    await assistantPublicPrisma.$disconnect();
    await prisma.$disconnect();
  });

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
    current_user: "shopsphere_assistant_private_runtime",
  });
  const [publicAttributes] = await assistantPublicPrisma.$queryRawUnsafe(`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolbypassrls,
           current_user AS current_user
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  assert.deepEqual(publicAttributes, {
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
    orders_read: false,
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
    option_id_read: true,
  });
  const [publicPrivileges] = await assistantPublicPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'products', 'name', 'SELECT') AS product_name_read,
      has_column_privilege(current_user, 'products', 'sellerId', 'SELECT') AS product_seller_read,
      has_column_privilege(current_user, 'products', 'discount', 'SELECT') AS product_discount_read,
      has_column_privilege(current_user, 'product_options', 'value', 'SELECT') AS option_value_read,
      has_column_privilege(current_user, 'product_options', 'stock', 'SELECT') AS option_stock_read,
      has_column_privilege(current_user, 'users', 'firstName', 'SELECT') AS profile_read,
      has_column_privilege(current_user, 'notifications', 'title', 'SELECT') AS notification_read,
      has_table_privilege(current_user, 'assistant_audit_events', 'INSERT') AS audit_insert
  `);
  assert.deepEqual(publicPrivileges, {
    product_name_read: true,
    product_seller_read: false,
    product_discount_read: false,
    option_value_read: true,
    option_stock_read: false,
    profile_read: false,
    notification_read: false,
    audit_insert: false,
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
                  'payments'::regclass, 'refunds'::regclass, 'promo_codes'::regclass, 'promo_code_usages'::regclass,
                  'products'::regclass, 'product_options'::regclass)
  `);
  assert.equal(rlsTables.length, 10);
  for (const table of rlsTables) assert.deepEqual(table, { ...table, rls: true, force: true });
  // The catalog role can see the seeded public fixture without assuming the
  // staging database contains no other synthetic catalog products.
  assert.deepEqual(
    await assistantPublicPrisma.product.findUnique({
      where: { id: "d1d1d1d1d1d1d1d1d1d1d1d1" },
      select: { id: true },
    }),
    { id: "d1d1d1d1d1d1d1d1d1d1d1d1" },
  );
  await assert.rejects(
    assistantPublicPrisma.product.findMany({ select: { sellerId: true } }),
    /permission denied|database query/i,
  );
  await assert.rejects(
    assistantPublicPrisma.productOption.findMany({ select: { stock: true } }),
    /permission denied|database query/i,
  );
  // A transaction-local custom GUC can reset to an empty string on a reused
  // connection; the public policy normalizes that state back to no actor.
  await assistantPublicPrisma.$transaction((tx) =>
    tx.$executeRawUnsafe("SELECT set_config('shopsphere.actor_id', 'temporary', true)"));
  assert.deepEqual(
    await assistantPublicPrisma.product.findUnique({
      where: { id: "d1d1d1d1d1d1d1d1d1d1d1d1" },
      select: { id: true },
    }),
    { id: "d1d1d1d1d1d1d1d1d1d1d1d1" },
  );

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

  // Shared catalog tables (#12/#13/#14 RLS): the public no-actor path is
  // unchanged, while actor-context reads narrow to owned, cart-contained, or
  // self-ordered rows — the seller-private columns are never enumerable.
  const sellerCatalogOp = { ...actorB, operation: "products.getMine" };
  const benProducts = await withAssistantActor(sellerCatalogOp, (tx) => tx.product.findMany({ select: { id: true } }));
  assert.deepEqual(benProducts.map(({ id }) => id), ["d1d1d1d1d1d1d1d1d1d1d1d1"]);
  const benOptions = await withAssistantActor(sellerCatalogOp, (tx) => tx.productOption.findMany({ select: { value: true, stock: true } }));
  assert.deepEqual(benOptions, [{ value: "Red", stock: 4 }]);
  const adaProductView = await withAssistantActor(
    { ...actorA, operation: "cart.getMine" },
    (tx) => tx.product.findMany({ select: { id: true } }),
  );
  assert.deepEqual(adaProductView.map(({ id }) => id), ["d1d1d1d1d1d1d1d1d1d1d1d1"]);
  const eveActor = { actorId: "dddddddddddddddddddddddd", role: "user", operation: "cart.getMine" };
  assert.deepEqual(await withAssistantActor(eveActor, (tx) => tx.product.findMany({ select: { id: true } })), []);
  assert.deepEqual(await withAssistantActor(eveActor, (tx) => tx.productOption.findMany({ select: { value: true } })), []);

  // Repeated-call purity on a real database (#12): validating a promo and
  // previewing checkout twice changes no promo counter, usage row, order,
  // bill, or payment — only audit and rate-limit metadata may move.
  const promoRow = (operation) => withAssistantActor(
    { ...actorA, operation },
    (tx) => tx.promoCode.findFirst({ where: { code: "RLS11" }, select: { usedCount: true } }),
  );
  const usageRows = (operation) => withAssistantActor(
    { ...actorA, operation },
    (tx) => tx.promoCodeUsage.count({ where: { promoCodeId: "a1a1a1a1a1a1a1a1a1a1a1a1", userId: actorA.actorId } }),
  );
  const commerceSnapshot = async () => {
    const [orders, bills, payments] = await Promise.all([
      withAssistantActor(buyerOrders, (tx) => tx.order.count({ where: { userId: actorA.actorId } })),
      withAssistantActor(billOp, (tx) => tx.bill.count({ where: { userId: actorA.actorId } })),
      withAssistantActor(paymentOp, (tx) => tx.payment.count()),
    ]);
    return { orders, bills, payments };
  };
  const promoBefore = await promoRow("cart.validatePromo");
  const usageBefore = await usageRows("cart.validatePromo");
  const commerceBefore = await commerceSnapshot();

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "assistant-rls-test", alg: "RS256", use: "sig" };
  const issuerServer = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url?.endsWith("/certs") ? { keys: [jwk] } : { active: true }));
  });
  await new Promise((resolve) => issuerServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => issuerServer.close((error) => error ? reject(error) : resolve())));
  const issuer = `http://127.0.0.1:${issuerServer.address().port}/realms/shopsphere`;
  process.env.ASSISTANT_API_TOKEN = "assistant-integration-workload-token";
  process.env.MCP_OAUTH_ISSUER = issuer;
  process.env.MCP_OAUTH_JWKS_URI = `${issuer}/protocol/openid-connect/certs`;
  process.env.MCP_OAUTH_INTROSPECTION_ENDPOINT = `${issuer}/protocol/openid-connect/token/introspect`;
  process.env.MCP_OAUTH_INTROSPECTION_CLIENT_ID = "assistant-integration";
  process.env.MCP_OAUTH_INTROSPECTION_CLIENT_SECRET = "assistant-integration-secret";
  process.env.MCP_WORKLOAD_CLIENT_ID = "shopsphere-mcp-workload";
  process.env.MCP_ACCOUNT_COHORT = actorA.actorId;
  process.env.MCP_TOOL_VALIDATE_PROMO_CODE_ENABLED = "true";
  process.env.MCP_TOOL_PREVIEW_CHECKOUT_ENABLED = "true";
  const delegatedToken = await new SignJWT({
    sid: "assistant-rls-grant",
    azp: "shopsphere-mcp-workload",
    client_id: "assistant-rls-client",
    scope: "cart:read",
    shopsphere_user_id: actorA.actorId,
    shopsphere_role: "user",
    shopsphere_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience("shopsphere-assistant-api")
    .setSubject(actorA.actorId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const { default: assistantRouter } = await import("../routes/assistantRoute.js");
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use("/api/v1/assistant", assistantRouter);
  const apiServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => apiServer.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve())));

  const redis = await getAssistantRedis();
  t.after(async () => { if (redis.isOpen) await redis.quit(); });
  const keyPart = (value) => crypto.createHash("sha256").update(value).digest("base64url");
  const rateKey = `shopsphere:assistant:rate:subject-client:${keyPart(`${actorA.actorId}:assistant-rls-client`)}`;
  await redis.del(rateKey);
  const auditBefore = await prisma.assistantAuditEvent.count({ where: { subjectId: actorA.actorId } });
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/v1/assistant/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${delegatedToken}`,
        "content-type": "application/json",
        "x-assistant-api-token": process.env.ASSISTANT_API_TOKEN,
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      assert.fail(`${path}: ${response.status} ${await response.text()}`);
    }
    return response.json();
  };
  const first = await call("validate_promo_code", { code: "rls11" });
  const second = await call("validate_promo_code", { code: "RLS11" });
  const firstPreview = await call("preview_checkout", { promoCode: "RLS11" });
  const secondPreview = await call("preview_checkout", { promoCode: "rls11" });
  assert.equal(first.valid, true);
  assert.deepEqual(second, first);
  assert.equal(firstPreview.promo.code, "RLS11");
  assert.deepEqual(secondPreview, firstPreview);
  assert.deepEqual(await promoRow("cart.validatePromo"), promoBefore);
  assert.equal(await usageRows("cart.validatePromo"), usageBefore);
  assert.deepEqual(await commerceSnapshot(), commerceBefore);
  assert.equal(await prisma.assistantAuditEvent.count({ where: { subjectId: actorA.actorId } }), auditBefore + 4);
  assert.equal(await redis.get(rateKey), "4");
});
