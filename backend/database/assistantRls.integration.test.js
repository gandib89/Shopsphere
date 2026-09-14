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
      has_table_privilege(current_user, 'orders', 'SELECT') AS orders_read
  `);
  assert.deepEqual(privileges, { profile_read: true, email_read: false, orders_read: false });
  const [rls] = await assistantPrisma.$queryRawUnsafe(`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'users'::regclass
  `);
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  assert.deepEqual(await assistantPrisma.product.count({ select: { id: true } }), { id: 0 });

  assert.deepEqual(await assistantPrisma.user.findMany({ select: projection }), []);
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
});
