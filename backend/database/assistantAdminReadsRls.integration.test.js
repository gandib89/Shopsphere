// Integration gate for the #16 admin reads (mirrors assistantRls.integration
// but scoped to the new admin grants/policies so parallel tickets never share
// a file). Requires RUN_POSTGRES_INTEGRATION=true plus the migrated database,
// provisioned roles, and seeded fixtures from scripts/seedAssistantRlsTest.js:
// Ben (bbbbbbbbbbbbbbbbbbbbbbbb, seller), Ada's order f3f3… over Ben's product
// d1d1…, and Ada's succeeded payment e8e8….
import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import { prisma } from "./prismaClient.js";
import {
  getPlatformRevenueSummary,
  listSellerApplications,
} from "../services/assistantAdminReads.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const SECRET = "assistant-admin-reads-cursor-secret-32-bytes!";
const ADMIN_ID = "eeeeeeeeeeeeeeeeeeeeeeee"; // actor context only; no user row
const BEN_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const adminPrincipal = { subject: ADMIN_ID, role: "admin", clientId: "client-1", grantId: "grant-1" };
const revenueId = "b8b8b8b8b8b8b8b8b8b8b8b8";
const refundId = "c9c9c9c9c9c9c9c9c9c9c9c9";

test("admin platform reads are RLS-scoped with minimized projections", { skip: !enabled }, async (t) => {
  t.after(async () => {
    await prisma.refund.deleteMany({ where: { id: refundId } });
    await prisma.revenue.deleteMany({ where: { id: revenueId } });
    await assistantPrisma.$disconnect();
    await prisma.$disconnect();
  });

  // Column grants: the application projection adds exactly the shop display and
  // verification columns; contacts, credentials, and addresses stay ungranted.
  const [privileges] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'users', 'shopName', 'SELECT') AS shop_name_read,
      has_column_privilege(current_user, 'users', 'shopDescription', 'SELECT') AS shop_description_read,
      has_column_privilege(current_user, 'users', 'verificationRequestDate', 'SELECT') AS request_date_read,
      has_column_privilege(current_user, 'users', 'verificationApprovedDate', 'SELECT') AS approved_date_read,
      has_column_privilege(current_user, 'users', 'verificationRejectionReason', 'SELECT') AS rejection_read,
      has_column_privilege(current_user, 'users', 'createdAt', 'SELECT') AS created_at_read,
      has_column_privilege(current_user, 'users', 'email', 'SELECT') AS email_read,
      has_column_privilege(current_user, 'users', 'phone', 'SELECT') AS phone_read,
      has_column_privilege(current_user, 'users', 'homeStreet', 'SELECT') AS address_read,
      has_column_privilege(current_user, 'users', 'password', 'SELECT') AS password_read,
      has_column_privilege(current_user, 'revenues', 'totalSalePrice', 'SELECT') AS revenue_amount_read,
      has_column_privilege(current_user, 'refunds', 'amount', 'SELECT') AS refund_amount_read
  `);
  assert.deepEqual(privileges, {
    shop_name_read: true,
    shop_description_read: true,
    request_date_read: true,
    approved_date_read: true,
    rejection_read: true,
    created_at_read: true,
    email_read: false,
    phone_read: false,
    address_read: false,
    password_read: false,
    revenue_amount_read: true,
    refund_amount_read: true,
  });
  const policies = await assistantPrisma.$queryRawUnsafe(`
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'shopsphere_assistant_revenue_admin',
        'shopsphere_assistant_refund_admin',
        'shopsphere_assistant_seller_application_admin')
    ORDER BY policyname
  `);
  assert.deepEqual(policies.map(({ policyname }) => policyname), [
    "shopsphere_assistant_refund_admin",
    "shopsphere_assistant_revenue_admin",
    "shopsphere_assistant_seller_application_admin",
  ]);

  // Fixtures: one Completed ledger row in March 2026 (platform-attributed,
  // sellerId NULL so the seller-only policy can never admit it) and one
  // succeeded refund completing the same month.
  await prisma.refund.deleteMany({ where: { id: refundId } });
  await prisma.revenue.deleteMany({ where: { id: revenueId } });
  await prisma.revenue.create({
    data: {
      id: revenueId,
      orderId: "f3f3f3f3f3f3f3f3f3f3f3f3",
      productId: "d1d1d1d1d1d1d1d1d1d1d1d1",
      totalSalePrice: "1000.10",
      adminCommission: "50.00",
      sellerRevenue: "950.10",
      month: 3,
      year: 2026,
      status: "Completed",
    },
  });
  await prisma.refund.create({
    data: {
      id: refundId,
      paymentId: "e8e8e8e8e8e8e8e8e8e8e8e8",
      orderId: "f3f3f3f3f3f3f3f3f3f3f3f3",
      amount: "12.34",
      status: "Succeeded",
      completedAt: new Date(2026, 2, 15),
      idempotencyKey: "rls-admin-refund-key-1",
      mode: "sandbox",
    },
  });

  // Platform aggregate through the real service over the RLS transaction.
  const summary = await withAssistantActor(
    { actorId: ADMIN_ID, role: "admin", operation: "platform.revenueSummary" },
    (tx) => getPlatformRevenueSummary({ year: 2026 }, { client: tx, principal: adminPrincipal, cursorSecret: SECRET }),
  );
  assert.equal(summary.buckets.length, 12);
  assert.deepEqual(summary.buckets[2], {
    month: 3,
    completedSaleCount: 1,
    grossSale: { amount: "1000.1", currency: "NPR" },
    adminCommission: { amount: "50", currency: "NPR" },
    sellerRevenue: { amount: "950.1", currency: "NPR" },
    refunded: { amount: "12.34", currency: "NPR" },
  });
  const serializedSummary = JSON.stringify(summary);
  assert.ok(!serializedSummary.includes(revenueId));
  assert.ok(!serializedSummary.includes(refundId));

  // The same ledger row is invisible to the seller policy and to every
  // context-free connection (RLS filters rows; grants filter columns).
  const sellerGroups = await withAssistantActor(
    { actorId: BEN_ID, role: "seller", operation: "sales.revenueSummary" },
    (tx) => tx.revenue.groupBy({
      by: ["month"],
      where: { year: 2026, status: "Completed" },
      _sum: { totalSalePrice: true },
      _count: { _all: true },
    }),
  );
  assert.deepEqual(sellerGroups, []);
  const anonymousGroups = await assistantPrisma.revenue.groupBy({
    by: ["month"],
    where: { year: 2026, status: "Completed" },
    _sum: { totalSalePrice: true },
    _count: { _all: true },
  });
  assert.deepEqual(anonymousGroups, []);

  // Seller applications: the admin policy admits seller rows only, under the
  // fixed operation; identity columns are ungranted even for admins.
  const visibleUsers = await withAssistantActor(
    { actorId: ADMIN_ID, role: "admin", operation: "sellers.listApplications" },
    (tx) => tx.user.findMany({ select: { id: true, role: true } }),
  );
  assert.ok(visibleUsers.some(({ id }) => id === BEN_ID));
  assert.ok(visibleUsers.every(({ id, role }) => id === ADMIN_ID || role === "seller"));
  await assert.rejects(
    withAssistantActor(
      { actorId: ADMIN_ID, role: "admin", operation: "sellers.listApplications" },
      (tx) => tx.user.findMany({ select: { email: true } }),
    ),
    /permission denied|database query/i,
  );
  const applications = await withAssistantActor(
    { actorId: ADMIN_ID, role: "admin", operation: "sellers.listApplications" },
    (tx) => listSellerApplications({}, { client: tx, principal: adminPrincipal, cursorSecret: SECRET }),
  );
  const benReference = `seller-${crypto.createHash("sha256")
    .update(`shopsphere-seller:${BEN_ID}`).digest("hex").slice(0, 12)}`;
  const ben = applications.applications.find((row) => row.sellerReference === benReference);
  assert.ok(ben);
  assert.equal(ben.status, "pending");
  assert.equal(ben.shopName, "");

  // The pre-existing self policy is unchanged: a seller under this operation
  // still sees exactly its own row and nothing else. Query the restricted
  // transaction directly: listSellerApplications is intentionally admin-only
  // and its defense-in-depth role check must continue rejecting sellers.
  const benApplications = await withAssistantActor(
    { actorId: BEN_ID, role: "seller", operation: "sellers.listApplications" },
    (tx) => tx.user.findMany({
      select: { id: true, role: true },
      orderBy: { id: "asc" },
    }),
  );
  assert.deepEqual(benApplications, [{ id: BEN_ID, role: "seller" }]);
});
