// Postgres integration coverage for the #18 admin promotion RLS surface.
// Runs against a migrated database with the restricted runtime roles
// provisioned and seedAssistantRlsTest.js applied (promos RLS10/RLS11, one
// usage row for RLS10). Self-skips without RUN_POSTGRES_INTEGRATION=true.
import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import {
  getPromotionUsageSummary,
  listPromotionConfiguration,
} from "../services/assistantAdminPromotions.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";

const ADMIN_ACTOR = "eeeeeeeeeeeeeeeeeeeeeeee";
const ADA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const CID = "cccccccccccccccccccccccc";
const BEN = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET = "integration-admin-promotions-cursor-secret-32!";
const PROMO_USED = "f9f9f9f9f9f9f9f9f9f9f9f9";
const PROMO_UNUSED = "a1a1a1a1a1a1a1a1a1a1a1a1";

const adminListActor = { actorId: ADMIN_ACTOR, role: "admin", operation: "promotions.listConfiguration" };
const adminUsageActor = { actorId: ADMIN_ACTOR, role: "admin", operation: "promotions.usageSummary" };
const adminPrincipal = { subject: ADMIN_ACTOR, role: "admin", clientId: "client-1", grantId: "grant-1" };

test("admin promotion reads keep column-scoped grants, operation-bound RLS, and buyer policies intact", { skip: !enabled }, async (t) => {
  t.after(async () => {
    await assistantPrisma.$disconnect();
  });

  // Column grants: the admin projection columns (plus the createdAt cursor
  // key) are readable; createdById and table-wide access are not.
  const [privileges] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'promo_codes', 'id', 'SELECT') AS promo_id_read,
      has_column_privilege(current_user, 'promo_codes', 'code', 'SELECT') AS promo_code_read,
      has_column_privilege(current_user, 'promo_codes', 'discountValue', 'SELECT') AS promo_value_read,
      has_column_privilege(current_user, 'promo_codes', 'createdAt', 'SELECT') AS promo_created_read,
      has_column_privilege(current_user, 'promo_codes', 'description', 'SELECT') AS promo_description_read,
      has_column_privilege(current_user, 'promo_codes', 'createdById', 'SELECT') AS promo_creator_read,
      has_table_privilege(current_user, 'promo_codes', 'SELECT') AS promo_table_read,
      has_table_privilege(current_user, 'promo_codes', 'UPDATE') AS promo_update,
      has_table_privilege(current_user, 'promo_codes', 'INSERT') AS promo_insert,
      has_table_privilege(current_user, 'promo_codes', 'DELETE') AS promo_delete,
      has_column_privilege(current_user, 'promo_code_usages', 'promoCodeId', 'SELECT') AS usage_code_read,
      has_column_privilege(current_user, 'promo_code_usages', 'userId', 'SELECT') AS usage_user_read,
      has_table_privilege(current_user, 'promo_code_usages', 'SELECT') AS usage_table_read,
      has_table_privilege(current_user, 'promo_code_usages', 'UPDATE') AS usage_update,
      has_table_privilege(current_user, 'promo_code_usages', 'INSERT') AS usage_insert,
      has_table_privilege(current_user, 'promo_code_usages', 'DELETE') AS usage_delete
  `);
  assert.deepEqual(privileges, {
    promo_id_read: true,
    promo_code_read: true,
    promo_value_read: true,
    promo_created_read: true,
    promo_description_read: true,
    promo_creator_read: false,
    promo_table_read: false,
    promo_update: false,
    promo_insert: false,
    promo_delete: false,
    usage_code_read: true,
    usage_user_read: true,
    usage_table_read: false,
    usage_update: false,
    usage_insert: false,
    usage_delete: false,
  });

  const [rlsFlags] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      c1.relrowsecurity AS promo_rls, c1.relforcerowsecurity AS promo_force,
      c2.relrowsecurity AS usage_rls, c2.relforcerowsecurity AS usage_force
    FROM pg_class c1, pg_class c2
    WHERE c1.oid = 'promo_codes'::regclass AND c2.oid = 'promo_code_usages'::regclass
  `);
  assert.deepEqual(rlsFlags, {
    promo_rls: true,
    promo_force: true,
    usage_rls: true,
    usage_force: true,
  });

  // Configuration listing: admin role + the two promotion operations see all
  // rows; any other role or operation combination resolves to no rows.
  const listed = await withAssistantActor(adminListActor, (tx) =>
    tx.promoCode.findMany({ select: { code: true, createdAt: true }, orderBy: [{ code: "asc" }] }));
  assert.ok(listed.some(({ code }) => code === "RLS10"));
  assert.ok(listed.some(({ code }) => code === "RLS11"));

  const usageListed = await withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCode.findMany({ select: { code: true } }));
  assert.ok(usageListed.some(({ code }) => code === "RLS10"));

  for (const actor of [
    // The buyer validation operation must not become an admin enumeration path.
    { ...adminListActor, operation: "cart.validatePromo" },
    // Wrong roles never read configuration through the promotion operations.
    { ...adminListActor, role: "seller" },
    { ...adminListActor, role: "user" },
  ]) {
    const rows = await withAssistantActor(actor, (tx) =>
      tx.promoCode.findMany({ select: { code: true } }));
    assert.deepEqual(rows, [], `${actor.role}/${actor.operation} must resolve to no rows`);
  }

  // Usage rows: only the usage-summary operation in the admin role can count
  // them; the configuration listing operation and every buyer/seller
  // combination stay locked out.
  const usageCount = await withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCodeUsage.count({ where: { promoCodeId: PROMO_USED } }));
  assert.equal(usageCount, 1);
  assert.equal(await withAssistantActor(adminListActor, (tx) => tx.promoCodeUsage.count()), 0);
  assert.equal(await withAssistantActor({ ...adminUsageActor, role: "seller" }, (tx) => tx.promoCodeUsage.count()), 0);

  // Buyer validation surface is unchanged: the buyer still reads the active
  // promos and only their own usage rows.
  const buyerPromoActor = { actorId: ADA, role: "user", operation: "cart.validatePromo" };
  const buyerPromos = await withAssistantActor(buyerPromoActor, (tx) =>
    tx.promoCode.findMany({ select: { code: true } }));
  assert.ok(buyerPromos.some(({ code }) => code === "RLS10"));
  assert.equal(await withAssistantActor(buyerPromoActor, (tx) => tx.promoCodeUsage.count()), 1);
  assert.equal(
    await withAssistantActor({ actorId: CID, role: "user", operation: "cart.validatePromo" }, (tx) => tx.promoCodeUsage.count()),
    0,
  );

  // The tools are read-only at the database boundary: under the exact actor
  // context the reads use, mutations are refused (no UPDATE/INSERT/DELETE
  // grants, SELECT-only policies).
  await assert.rejects(withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCode.update({ where: { id: PROMO_USED }, data: { isActive: false } })));
  await assert.rejects(withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCode.update({ where: { id: PROMO_USED }, data: { usedCount: 0 } })));
  await assert.rejects(withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCode.delete({ where: { id: PROMO_USED } })));
  await assert.rejects(withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCodeUsage.create({ data: { promoCodeId: PROMO_UNUSED, userId: ADA } })));
  await assert.rejects(withAssistantActor(adminUsageActor, (tx) =>
    tx.promoCodeUsage.delete({ where: { promoCodeId_userId: { promoCodeId: PROMO_USED, userId: ADA } } })));

  // End to end through the real services: allowlisted output shapes and
  // aggregate-only counters against live rows.
  const page = await withAssistantActor(adminListActor, (tx) =>
    listPromotionConfiguration({}, { client: tx, principal: adminPrincipal, cursorSecret: SECRET }));
  const used = page.promotions.find(({ code }) => code === "RLS10");
  assert.ok(used);
  assert.deepEqual(used.discountValue, { percent: "10" });
  assert.deepEqual(used.minPurchase, { amount: "0", currency: "NPR" });
  assert.equal(used.isActive, true);
  const serializedPage = JSON.stringify(page);
  assert.ok(!serializedPage.includes("createdById"));
  assert.ok(!serializedPage.includes(ADA));

  const usedSummary = await withAssistantActor(adminUsageActor, (tx) =>
    getPromotionUsageSummary({ promoCodeId: PROMO_USED }, { client: tx, principal: adminPrincipal }));
  assert.equal(usedSummary.code, "RLS10");
  assert.equal(usedSummary.totalRedemptions, 0);
  assert.equal(usedSummary.distinctUsers, 1);
  assert.equal(usedSummary.active, true);

  const unusedSummary = await withAssistantActor(adminUsageActor, (tx) =>
    getPromotionUsageSummary({ promoCodeId: PROMO_UNUSED }, { client: tx, principal: adminPrincipal }));
  assert.equal(unusedSummary.distinctUsers, 0);
  assert.equal(unusedSummary.totalRedemptions, 0);

  await assert.rejects(withAssistantActor(
    { actorId: BEN, role: "seller", operation: "promotions.usageSummary" },
    (tx) => getPromotionUsageSummary({ promoCodeId: PROMO_USED }, { client: tx, principal: { subject: BEN, role: "seller", clientId: "c", grantId: "g" } }),
  ), { statusCode: 404 });
});
