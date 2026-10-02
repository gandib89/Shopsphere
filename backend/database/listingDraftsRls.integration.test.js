// RLS integration coverage for the #20 listing_drafts table (self-contained
// fixtures; runs only against a migrated Postgres with provisioned roles).
import assert from "node:assert/strict";
import test from "node:test";

import { assistantPrisma } from "./assistantPrisma.js";
import { withAssistantActor } from "./assistantTransaction.js";
import { prisma } from "./prismaClient.js";
import { saveListingDraft } from "../services/assistantListingDrafts.js";
import { recordAssistantAudit } from "../services/assistantAudit.js";
import crypto from "node:crypto";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";

const SELLER = "5a5a5a5a5a5a5a5a5a5a5a5a";
const RIVAL = "6b6b6b6b6b6b6b6b6b6b6b6b";
const GRANT = "integration-listing-grant";
const OTHER_GRANT = "integration-listing-grant-2";
const PRODUCT = "7c7c7c7c7c7c7c7c7c7c7c7c";
const DRAFT = "8d8d8d8d8d8d8d8d8d8d8d8d";
const RIVAL_DRAFT = "9e9e9e9e9e9e9e9e9e9e9e9e";

const sellerActor = (operation, grantId = GRANT) => ({
  actorId: SELLER,
  role: "seller",
  operation,
  grantId,
});

test("listing_drafts RLS isolates drafts by subject and operation", { skip: !enabled }, async (t) => {
  const ownedChildIds = [];
  t.after(async () => {
    await prisma.listingDraft.deleteMany({ where: { id: { in: [DRAFT, RIVAL_DRAFT, ...ownedChildIds] } } });
    await prisma.product.deleteMany({ where: { id: PRODUCT } });
    await prisma.user.deleteMany({ where: { id: { in: [SELLER, RIVAL] } } });
    await assistantPrisma.$disconnect();
    await prisma.$disconnect();
  });

  // Self-contained fixtures (additive, idempotent, cleaned up above).
  await prisma.user.createMany({
    data: [
      { id: SELLER, firstName: "Dana", lastName: "Drafts", email: "rls-drafts-a@example.test", role: "seller", isVerified: false },
      { id: RIVAL, firstName: "Riva", lastName: "Rival", email: "rls-drafts-b@example.test", role: "seller", isVerified: true },
    ],
    skipDuplicates: true,
  });
  await prisma.product.create({
    data: { id: PRODUCT, name: "Draft Lamp", price: 19.99, quantity: 3, category: "Home", sellerId: SELLER },
  });
  await prisma.productOption.create({
    data: { id: "rls-draft-option-1", productId: PRODUCT, kind: "color", value: "Amber" },
  });
  await prisma.listingDraft.createMany({
    data: [
      {
        id: DRAFT,
        sellerId: SELLER,
        grantId: GRANT,
        sourceProductId: PRODUCT,
        title: "Unpublished lamp",
        description: "A draft awaiting review.",
        highlights: ["warm glow"],
        status: "Draft",
        version: 1,
      },
      {
        id: RIVAL_DRAFT,
        sellerId: RIVAL,
        grantId: OTHER_GRANT,
        title: "Rival draft",
        description: "Another seller's draft.",
        status: "Draft",
        version: 1,
      },
    ],
    skipDuplicates: true,
  });

  const [privileges] = await assistantPrisma.$queryRawUnsafe(`
    SELECT
      has_column_privilege(current_user, 'listing_drafts', 'title', 'SELECT') AS title_read,
      has_column_privilege(current_user, 'listing_drafts', 'grantId', 'SELECT') AS grant_read,
      has_column_privilege(current_user, 'listing_drafts', 'title', 'INSERT') AS title_insert,
      has_column_privilege(current_user, 'listing_drafts', 'description', 'UPDATE') AS description_update,
      has_column_privilege(current_user, 'listing_drafts', 'status', 'UPDATE') AS status_update,
      has_column_privilege(current_user, 'listing_drafts', 'updatedAt', 'UPDATE') AS updated_update,
      has_table_privilege(current_user, 'listing_drafts', 'DELETE') AS delete_any,
      has_column_privilege(current_user, 'products', 'sellerId', 'SELECT') AS product_seller_read
  `);
  assert.deepEqual(privileges, {
    title_read: true,
    grant_read: true,
    title_insert: true,
    description_update: false,
    status_update: true,
    updated_update: true,
    delete_any: false,
    product_seller_read: true,
  });
  const [rls] = await assistantPrisma.$queryRawUnsafe(`
    SELECT relrowsecurity AS rls, relforcerowsecurity AS force
    FROM pg_class WHERE oid = 'listing_drafts'::regclass
  `);
  assert.deepEqual(rls, { rls: true, force: true });

  // No actor context: the private runtime sees nothing.
  assert.deepEqual(await assistantPrisma.listingDraft.findMany({ select: { id: true } }), []);

  // Own rows only, and only under a listings.* operation.
  const ownDrafts = await withAssistantActor(sellerActor("listings.listDrafts"), (tx) =>
    tx.listingDraft.findMany({ select: { id: true, title: true } }));
  assert.deepEqual(ownDrafts.map(({ id }) => id), [DRAFT]);
  const rivalDrafts = await withAssistantActor({ ...sellerActor("listings.listDrafts", OTHER_GRANT), actorId: RIVAL }, (tx) =>
    tx.listingDraft.findMany({ select: { id: true } }));
  assert.deepEqual(rivalDrafts.map(({ id }) => id), [RIVAL_DRAFT]);
  // No application grant predicate: PostgreSQL itself denies the same owner's
  // draft to another or absent grant, and connection reuse clears the GUC.
  for (const grantId of [OTHER_GRANT, ""]) {
    assert.deepEqual(await withAssistantActor(sellerActor("listings.listDrafts", grantId), (tx) =>
      tx.listingDraft.findMany({ where: { id: DRAFT }, select: { id: true } })), []);
    const update = await withAssistantActor(sellerActor("listings.saveDraft", grantId), (tx) =>
      tx.listingDraft.updateMany({ where: { id: DRAFT }, data: { status: "Superseded" } }));
    assert.equal(update.count, 0);
  }
  assert.deepEqual(await assistantPrisma.listingDraft.findMany({ select: { id: true } }), []);
  await assert.rejects(withAssistantActor(sellerActor("listings.saveDraft", OTHER_GRANT), (tx) =>
    tx.listingDraft.create({ data: { id: "cececececececececececece", sellerId: SELLER, grantId: GRANT, title: "Wrong grant", description: "Denied" } })), /row-level security|permission denied/i);
  assert.deepEqual(await withAssistantActor(sellerActor("notifications.listMine"), (tx) =>
    tx.listingDraft.findMany({ select: { id: true } })), []);
  assert.deepEqual(await withAssistantActor({ ...sellerActor("listings.listDrafts"), role: "user" }, (tx) =>
    tx.listingDraft.findMany({ select: { id: true } })), []);

  // Inserts are saveDraft-only and must target the acting subject.
  await withAssistantActor(sellerActor("listings.saveDraft"), async (tx) => {
    await tx.listingDraft.create({
      data: {
        id: "afafafafafafafafafafafaf",
        sellerId: SELLER,
        grantId: GRANT,
        title: "Inserted draft",
        description: "Through the RLS policy.",
        status: "Draft",
        version: 1,
      },
    });
  });
  await prisma.listingDraft.delete({ where: { id: "afafafafafafafafafafafaf" } });
  await assert.rejects(
    withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
      tx.listingDraft.create({
        data: {
          id: "bfbfbfbfbfbfbfbfbfbfbfbf",
          sellerId: RIVAL,
          grantId: GRANT,
          title: "Smuggled draft",
          description: "Wrong subject.",
          status: "Draft",
          version: 1,
        },
      })),
    /row-level security|permission denied/i,
  );

  // The only mutation is the supersede transition: content columns have no
  // UPDATE grant, and the WITH CHECK blocks reverting the status.
  await withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
    tx.listingDraft.update({ where: { id: DRAFT }, data: { status: "Superseded" } }));
  const [row] = await prisma.listingDraft.findMany({ where: { id: DRAFT }, select: { status: true, version: true, title: true } });
  assert.equal(row.status, "Superseded");
  assert.equal(row.version, 1);
  assert.equal(row.title, "Unpublished lamp");
  await assert.rejects(
    withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
      tx.listingDraft.update({ where: { id: DRAFT }, data: { title: "Rewritten", updatedAt: new Date() } })),
    /permission denied|row-level security/i,
  );
  await assert.rejects(
    withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
      tx.listingDraft.update({ where: { id: DRAFT }, data: { status: "Draft", updatedAt: new Date() } })),
    /row-level security|permission denied/i,
  );
  await assert.rejects(
    withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
      tx.listingDraft.delete({ where: { id: DRAFT } })),
    /permission denied|row-level security/i,
  );
  // Restore the fixture state.
  await prisma.listingDraft.update({ where: { id: DRAFT }, data: { status: "Draft" } });

  // Competing pooled transactions claim exactly one current version. A retry
  // of the superseded parent cannot create another child.
  const auditTrace = `listing-grant-integration-${crypto.randomUUID()}`;
  const save = () => withAssistantActor(sellerActor("listings.saveDraft"), async (tx) => {
    const result = await saveListingDraft({ draftId: DRAFT, title: "Next version", description: "Still unpublished" }, {
      client: tx, principal: { subject: SELLER, grantId: GRANT },
    });
    const audit = await recordAssistantAudit({ traceId: auditTrace, operation: "listings.saveDraft", subjectId: SELLER, grantId: GRANT, outcome: "success", response: result }, tx, { writeOnly: true });
    assert.equal(audit.count, 1);
    return result;
  });
  const results = await Promise.allSettled([save(), save()]);
  for (const result of results) if (result.status === "fulfilled") ownedChildIds.push(result.value.draftId);
  assert.equal(ownedChildIds.length, 1);
  assert.equal(results.find(({ status }) => status === "rejected").reason.statusCode, 404);
  await assert.rejects(save(), { statusCode: 404 });
  const children = await prisma.listingDraft.findMany({ where: { supersedesId: DRAFT } });
  assert.equal(children.length, 1);
  assert.equal(children[0].version, 2);
  const successAudits = await prisma.assistantAuditEvent.findMany({ where: { traceId: auditTrace } });
  assert.equal(successAudits.length, 1);
  assert.ok(successAudits[0].responseDigest);
  // Retain the successful audit: integration cleanup never deletes history.
  // Failed child insertion rolls back the parent's claim.
  await prisma.listingDraft.update({ where: { id: DRAFT }, data: { status: "Draft" } });
  await assert.rejects(withAssistantActor(sellerActor("listings.saveDraft"), async (tx) => {
    await tx.listingDraft.updateMany({ where: { id: DRAFT, status: "Draft" }, data: { status: "Superseded" } });
    await tx.listingDraft.create({ data: { id: DRAFT, sellerId: SELLER, grantId: GRANT, title: "Duplicate", description: "Fails" } });
  }));
  assert.equal((await prisma.listingDraft.findUnique({ where: { id: DRAFT } })).status, "Draft");
  // A real durable-audit INSERT failure must roll back both a fresh child and
  // its parent claim. The invalid operation exceeds the PostgreSQL varchar.
  const beforeFailedAudit = await prisma.listingDraft.count({ where: { supersedesId: DRAFT } });
  const failedTrace = `listing-audit-failure-${crypto.randomUUID()}`;
  await assert.rejects(withAssistantActor(sellerActor("listings.saveDraft"), async (tx) => {
    await saveListingDraft({ draftId: DRAFT, title: "Must roll back", description: "Audit failure" }, { client: tx, principal: { subject: SELLER, grantId: GRANT } });
    await recordAssistantAudit({ traceId: failedTrace, operation: "x".repeat(101), outcome: "success" }, tx, { writeOnly: true });
  }));
  assert.equal(await prisma.listingDraft.count({ where: { supersedesId: DRAFT } }), beforeFailedAudit);
  assert.equal((await prisma.listingDraft.findUnique({ where: { id: DRAFT } })).status, "Draft");
  assert.equal(await prisma.assistantAuditEvent.count({ where: { traceId: failedTrace } }), 0);

  // Draft copy may read the seller's own product through the additive
  // listings.draftCopy policies — and only the seller's own rows.
  const ownProducts = await withAssistantActor(sellerActor("listings.draftCopy"), (tx) =>
    tx.product.findMany({ where: { sellerId: SELLER }, select: { id: true } }));
  assert.deepEqual(ownProducts.map(({ id }) => id), [PRODUCT]);
  // The save-time provenance check (saveListingDraft verifying a supplied
  // sourceProductId is owned) reads products under listings.saveDraft too.
  const saveDraftProducts = await withAssistantActor(sellerActor("listings.saveDraft"), (tx) =>
    tx.product.findMany({ where: { sellerId: SELLER }, select: { id: true } }));
  assert.deepEqual(saveDraftProducts.map(({ id }) => id), [PRODUCT]);
  const ownOptions = await withAssistantActor(sellerActor("listings.draftCopy"), (tx) =>
    tx.productOption.findMany({ select: { kind: true, value: true } }));
  assert.deepEqual(ownOptions, [{ kind: "color", value: "Amber" }]);
  const rivalProducts = await withAssistantActor({ ...sellerActor("listings.draftCopy"), actorId: RIVAL }, (tx) =>
    tx.product.findMany({ select: { id: true } }));
  assert.deepEqual(rivalProducts, []);
  await withAssistantActor(sellerActor("listings.draftCopy"), (tx) =>
    tx.product.findFirst({ where: { id: PRODUCT, sellerId: SELLER }, select: { name: true } }));
  // The stored grant column participates in the restrictive RLS policy.
  const [columns] = await assistantPrisma.$queryRawUnsafe(`
    SELECT count(*)::int AS grants FROM information_schema.columns
    WHERE table_name = 'listing_drafts' AND column_name = 'grantId'
  `);
  assert.equal(columns.grants, 1);
});
