// Integration coverage for the #17 admin support queues (PostgreSQL 16).
// Requires the full assistant RLS stack: `prisma migrate deploy`,
// `scripts/provisionAssistantRole.js`, and RUN_POSTGRES_INTEGRATION=true.
// Verifies that the fixed queue membership survives the database layer: the
// admin policies admit rows only under the three support operations, refunds
// resolve through the parent order, the projected columns are exactly the
// granted ones, buyer contact/address columns are not even readable, and
// quarantined/stale/non-queued rows stay invisible.
import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import { prisma } from "./prismaClient.js";
import {
  getOrderExceptionDetail,
  listOrderExceptionQueue,
  listReturnQueue,
} from "../services/assistantAdminQueues.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";

const ADMIN = "eeeeeeeeeeeeeeeeeeeeeeee";
// A dedicated queue buyer keeps the shared seed's counts untouched (the
// existing RLS integration test pins exact product/catalog cardinalities).
const BUYER = "777777777777777777777777";
const SELLER = "bbbbbbbbbbbbbbbbbbbbbbbb";
// The seed's product: reusing its id keeps the catalog cardinality pinned by
// the existing RLS test at exactly one product row.
const PRODUCT = "d1d1d1d1d1d1d1d1d1d1d1d1";
const PAYMENT_FAILED = "727272727272727272727272";
const PAYMENT_RELEASED = "767676767676767676767676";
const REFUND_FAILED = "828282828282828282828282";
const REFUND_RELEASED = "868686868686868686868686";
const Q_RETURN_REQUESTED = "616161616161616161616161";
const Q_REFUND_FAILED = "626262626262626262626262";
const Q_DELIVERED = "636363636363636363636363";
const Q_STALE = "646464646464646464646464";
const Q_QUARANTINED = "656565656565656565656565";
const Q_REFUND_RELEASED = "666666666666666666666666";
const QUEUED_IDS = [Q_RETURN_REQUESTED, Q_REFUND_FAILED, Q_REFUND_RELEASED];

const SECRET = "rls-admin-queue-cursor-secret-32-bytes!!";
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

const principal = () => ({ subject: ADMIN, role: "admin", clientId: "shopsphere-mcp-client", grantId: "grant-rls" });

const orderBase = (id, overrides = {}) => ({
  id,
  firstName: "Quinn",
  lastName: "Buyer",
  productId: PRODUCT,
  quantity: 1,
  deliveryDate: daysAgo(1),
  email: "rls-q@example.test",
  totalPrice: "59.99",
  status: "Return Requested",
  createdAt: daysAgo(2),
  ...overrides,
});

const seedFixtures = async () => {
  await prisma.user.upsert({
    where: { id: ADMIN },
    create: { id: ADMIN, firstName: "Rls", lastName: "Admin", email: "rls-admin@example.test", role: "admin", isVerified: true },
    update: { role: "admin", isVerified: true },
  });
  // Independent of the shared seed script: the queue fixtures own their buyer
  // and seller rows too.
  await prisma.user.upsert({
    where: { id: BUYER },
    create: { id: BUYER, firstName: "Quinn", lastName: "Buyer", email: "rls-q@example.test", role: "user", isVerified: true },
    update: { role: "user", isVerified: true },
  });
  await prisma.user.upsert({
    where: { id: SELLER },
    create: { id: SELLER, firstName: "Ben", lastName: "Seller", email: "rls-b@example.test", role: "seller", isVerified: true },
    update: { role: "seller", isVerified: true },
  });
  await prisma.product.upsert({
    where: { id: PRODUCT },
    create: { id: PRODUCT, name: "RLS Queue Gadget", price: "59.99", quantity: 10, category: "Test", sellerId: SELLER },
    update: {},
  });
  // Queued: live return request with evidence and reason.
  await prisma.order.upsert({
    where: { id: Q_RETURN_REQUESTED },
    create: orderBase(Q_RETURN_REQUESTED, {
      orderNumber: "RLS-Q-1",
      userId: BUYER,
      sellerIdAtPurchase: SELLER,
      returnRequestedAt: daysAgo(1),
      returnReason: "Arrived with a cracked screen",
      returnImage: "uploads/returns/rls-q1.png",
      status: "Return Requested",
    }),
    update: {},
  });
  // Queued: approved return whose refund failed — no recorded request stamp,
  // so it belongs to the exception queue only.
  await prisma.order.upsert({
    where: { id: Q_REFUND_FAILED },
    create: orderBase(Q_REFUND_FAILED, {
      orderNumber: "RLS-Q-2",
      userId: BUYER,
      sellerIdAtPurchase: SELLER,
      status: "Return Approved",
      createdAt: daysAgo(3),
    }),
    update: {},
  });
  await prisma.payment.upsert({
    where: { id: PAYMENT_FAILED },
    create: { id: PAYMENT_FAILED, orderId: Q_REFUND_FAILED, transactionUuid: "rls-q2-txn", productCode: "rls", amount: "59.99", status: "Succeeded" },
    update: { status: "Succeeded" },
  });
  await prisma.refund.upsert({
    where: { id: REFUND_FAILED },
    create: { id: REFUND_FAILED, paymentId: PAYMENT_FAILED, orderId: Q_REFUND_FAILED, amount: "59.99", status: "Failed", idempotencyKey: "rls-q2-refund" },
    update: { status: "Failed" },
  });
  // Not queued: delivered and healthy.
  await prisma.order.upsert({
    where: { id: Q_DELIVERED },
    create: orderBase(Q_DELIVERED, {
      orderNumber: "RLS-Q-3",
      userId: BUYER,
      sellerIdAtPurchase: SELLER,
      status: "Delivered",
      deliveredAt: daysAgo(1),
      createdAt: daysAgo(4),
    }),
    update: {},
  });
  // Not queued: return request outside the 90-day window.
  await prisma.order.upsert({
    where: { id: Q_STALE },
    create: orderBase(Q_STALE, {
      orderNumber: "RLS-Q-4",
      userId: BUYER,
      sellerIdAtPurchase: SELLER,
      returnRequestedAt: daysAgo(99),
      createdAt: daysAgo(100),
    }),
    update: {},
  });
  // Not queued: ambiguous legacy row (NULL buyer AND NULL seller attribution).
  await prisma.order.upsert({
    where: { id: Q_QUARANTINED },
    create: orderBase(Q_QUARANTINED, {
      orderNumber: "RLS-Q-5",
      userId: null,
      sellerIdAtPurchase: null,
      createdAt: daysAgo(5),
    }),
    update: {},
  });
  // Queued: finished refund release.
  await prisma.order.upsert({
    where: { id: Q_REFUND_RELEASED },
    create: orderBase(Q_REFUND_RELEASED, {
      orderNumber: "RLS-Q-6",
      userId: BUYER,
      sellerIdAtPurchase: SELLER,
      status: "Refund Released",
      refundReleasedAt: daysAgo(1),
      createdAt: daysAgo(6),
    }),
    update: {},
  });
  await prisma.payment.upsert({
    where: { id: PAYMENT_RELEASED },
    create: { id: PAYMENT_RELEASED, orderId: Q_REFUND_RELEASED, transactionUuid: "rls-q6-txn", productCode: "rls", amount: "59.99", status: "Succeeded" },
    update: { status: "Succeeded" },
  });
  await prisma.refund.upsert({
    where: { id: REFUND_RELEASED },
    create: {
      id: REFUND_RELEASED, paymentId: PAYMENT_RELEASED, orderId: Q_REFUND_RELEASED,
      amount: "59.99", status: "Succeeded", idempotencyKey: "rls-q6-refund", completedAt: daysAgo(1),
    },
    update: { status: "Succeeded" },
  });
};

test("admin support queues stay fixed and redacted through the RLS layer", { skip: !enabled }, async (t) => {
  t.after(async () => {
    await assistantPrisma.$disconnect();
    await prisma.$disconnect();
  });

  await seedFixtures();

  const [rlsFlags] = await assistantPrisma.$queryRawUnsafe(`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid = 'orders'::regclass
  `);
  assert.equal(rlsFlags.relrowsecurity, true);
  assert.equal(rlsFlags.relforcerowsecurity, true);

  const [grants] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'orders', 'orderNumber', 'SELECT') AS order_number,
      has_column_privilege(current_user, 'orders', 'returnRequestedAt', 'SELECT') AS return_requested,
      has_column_privilege(current_user, 'orders', 'returnReason', 'SELECT') AS return_reason,
      has_column_privilege(current_user, 'orders', 'returnImage', 'SELECT') AS return_image,
      has_column_privilege(current_user, 'orders', 'refundReleasedAt', 'SELECT') AS refund_released,
      has_column_privilege(current_user, 'orders', 'adminCommission', 'SELECT') AS admin_commission,
      has_column_privilege(current_user, 'orders', 'email', 'SELECT') AS email_read,
      has_column_privilege(current_user, 'orders', 'firstName', 'SELECT') AS first_name_read,
      has_column_privilege(current_user, 'orders', 'deliveryStreet', 'SELECT') AS delivery_read,
      has_column_privilege(current_user, 'orders', 'promoCode', 'SELECT') AS promo_read,
      has_column_privilege(current_user, 'refunds', 'status', 'SELECT') AS refund_status,
      has_column_privilege(current_user, 'refunds', 'amount', 'SELECT') AS refund_amount,
      has_column_privilege(current_user, 'refunds', 'providerRefundId', 'SELECT') AS refund_provider
  `);
  for (const granted of [grants.order_number, grants.return_requested, grants.return_reason, grants.return_image, grants.refund_released, grants.admin_commission, grants.refund_status, grants.refund_amount]) {
    assert.equal(granted, true);
  }
  // Contact, identity, delivery, promo, and provider columns are not even
  // granted — responses cannot leak what the runtime role cannot read.
  for (const denied of [grants.email_read, grants.first_name_read, grants.delivery_read, grants.promo_read, grants.refund_provider]) {
    assert.equal(denied, false);
  }

  // The exception queue resolves exactly the fixed membership: the two live
  // return states plus the refund-released row. Delivered, stale, and
  // quarantined rows never appear.
  const queue = await withAssistantActor({
    actorId: ADMIN,
    role: "admin",
    operation: "support.orderExceptionQueue",
  }, (tx) => listOrderExceptionQueue({}, {
    client: tx,
    principal: principal(),
    cursorSecret: SECRET,
  }));
  assert.deepEqual([...queue.orders.map(({ orderId }) => orderId)].sort(), [...QUEUED_IDS].sort());
  assert.ok(queue.orders.length <= 20);
  const byId = new Map(queue.orders.map((row) => [row.orderId, row]));
  assert.equal(byId.get(Q_REFUND_FAILED).status, "Return Approved");
  assert.equal(byId.get(Q_REFUND_FAILED).refundStatus, "Failed");
  assert.deepEqual(byId.get(Q_REFUND_FAILED).refundAmount, { amount: "59.99", currency: "NPR" });
  assert.equal(byId.get(Q_REFUND_RELEASED).status, "Refund Released");
  assert.equal(byId.get(Q_REFUND_RELEASED).refundStatus, "Succeeded");
  assert.equal(byId.get(Q_RETURN_REQUESTED).status, "Return Requested");
  assert.ok(byId.get(Q_RETURN_REQUESTED).orderNumber.startsWith("RLS-Q-"));
  assert.match(byId.get(Q_RETURN_REQUESTED).buyerReference, /^buyer-[0-9a-f]{12}$/);
  assert.match(byId.get(Q_RETURN_REQUESTED).sellerReference, /^seller-[0-9a-f]{12}$/);
  const serialized = JSON.stringify(queue);
  assert.ok(!serialized.includes("rls-a@example.test"));
  assert.ok(!serialized.includes(ADMIN));
  assert.ok(!serialized.includes("uploads"));

  // The return queue holds only the live return request: the failed-refund
  // row has no returnRequestedAt and the released refund is terminal.
  const returns = await withAssistantActor({
    actorId: ADMIN,
    role: "admin",
    operation: "support.returnQueue",
  }, (tx) => listReturnQueue({}, {
    client: tx,
    principal: principal(),
    cursorSecret: SECRET,
  }));
  assert.deepEqual(returns.returns.map(({ orderId }) => orderId), [Q_RETURN_REQUESTED]);
  assert.equal(returns.returns[0].hasReturnImage, true);
  assert.equal(returns.returns[0].returnReason, "Arrived with a cracked screen");

  // Detail: queued order resolves; non-queued, quarantined, and missing ids
  // are indistinguishable.
  const detail = await withAssistantActor({
    actorId: ADMIN,
    role: "admin",
    operation: "support.orderExceptionDetail",
  }, (tx) => getOrderExceptionDetail(
    { orderId: Q_RETURN_REQUESTED, purpose: "Review a customer refund complaint" },
    { client: tx, principal: principal() },
  ));
  assert.equal(detail.order.orderId, Q_RETURN_REQUESTED);
  assert.deepEqual(detail.order.totalPrice, { amount: "59.99", currency: "NPR" });
  for (const orderId of [Q_DELIVERED, Q_STALE, Q_QUARANTINED, "999999999999999999999999"]) {
    await assert.rejects(
      withAssistantActor({
        actorId: ADMIN,
        role: "admin",
        operation: "support.orderExceptionDetail",
      }, (tx) => getOrderExceptionDetail(
        { orderId, purpose: "Review a customer refund complaint" },
        { client: tx, principal: principal() },
      )),
      { statusCode: 404 },
    );
  }

  // RLS backstop: other roles and other operations resolve to no rows, and the
  // ungranted contact columns stay unreadable even for the admin operation.
  const userRows = await withAssistantActor({
    actorId: BUYER,
    role: "user",
    operation: "support.orderExceptionQueue",
  }, (tx) => tx.order.findMany({ select: { id: true } }));
  assert.deepEqual(userRows, []);
  const sellerRows = await withAssistantActor({
    actorId: ADMIN,
    role: "admin",
    operation: "orders.listMine",
  }, (tx) => tx.order.findMany({ select: { id: true } }));
  assert.deepEqual(sellerRows, []);
  await assert.rejects(
    withAssistantActor({
      actorId: ADMIN,
      role: "admin",
      operation: "support.orderExceptionQueue",
    }, (tx) => tx.$queryRawUnsafe('SELECT email FROM "orders" LIMIT 1')),
    /permission denied/i,
  );
  await assert.rejects(
    withAssistantActor({
      actorId: ADMIN,
      role: "admin",
      operation: "support.orderExceptionQueue",
    }, (tx) => tx.$queryRawUnsafe('SELECT "providerRefundId" FROM "refunds" LIMIT 1')),
    /permission denied/i,
  );

  // The existing seller path keeps working alongside the new policies.
  const sellerSales = await withAssistantActor({
    actorId: SELLER,
    role: "seller",
    operation: "sales.listMine",
  }, (tx) => tx.order.findMany({
    where: { sellerIdAtPurchase: SELLER },
    select: { id: true },
  }));
  assert.ok(sellerSales.some(({ id }) => id === Q_RETURN_REQUESTED));
});
