-- Seller listing proposals for #26 (PostgreSQL 16).
--
-- Two propose-class operations join the #22 proposal platform:
--   proposals.listingPublish       (propose_listing_publish, actionKind listing.publish_draft)
--   proposals.listingContentChange (propose_listing_content_change, actionKind listing.update_content)
-- Both run as shopsphere_assistant_private_runtime with actor_role 'seller',
-- so the #22 proposals policies — which admit only role 'user' under
-- proposals.proposeCartChange/proposals.actionStatus — are recreated below to
-- admit the seller-role operations additively (the user-role branches are
-- restored verbatim). The listing operations need three more reads:
--   - listing_drafts (owned draft snapshot for the publish preview), via the
--     #20 seller policy extended with the new operation;
--   - products (owned product content + updatedAt for the version proxy and
--     the before/after preview), via the #12 seller catalog policy extended
--     with the new operation;
--   - products."updatedAt" is a NEW column grant: no earlier assistant
--     projection read it (no UPDATE/DELETE grants are added anywhere — the
--     assistant runtime still cannot mutate products or drafts; the live
--     mutation happens only through the first-party owner path).
-- Finally, proposal creation writes its same-transaction "created" outbox
-- event (assistantProposals.js / assistantListingProposals.js), but #22 never
-- granted proposal_outbox_events to the restricted role; this migration adds
-- the missing column-scoped INSERT grant so every proposal action kind can
-- record its outcome. The append-only trigger from 20260919050000 still
-- rejects UPDATE and DELETE.

-- 1. New column grant: the content-change version proxy reads the product's
--    updatedAt (whole seconds are the proposals.expectedVersion encoding; see
--    assistantListingProposals.listingProductVersionOf).
GRANT SELECT ("updatedAt")
  ON TABLE products TO shopsphere_assistant_private_runtime;

-- 2. The "created" outbox event is inserted in the same transaction as the
--    proposal row. Column-scoped INSERT only (occurredAt must be granted
--    because the Prisma client supplies its @default(now()) value; id,
--    eventType, and payloadHash are supplied by the services). No SELECT, no
--    UPDATE, no DELETE.
GRANT INSERT (id, "proposalId", "eventType", "payloadHash", "occurredAt")
  ON TABLE proposal_outbox_events TO shopsphere_assistant_private_runtime;

-- 3. proposals SELECT: user-role cart operations verbatim from #22, plus the
--    seller-role listing operations. The seller branch also covers the
--    pending-proposal headroom count that enforceProposalCreationLimits runs
--    under the route's own operation.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND (
      (
        current_setting('shopsphere.actor_role', true) = 'user'
        AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus')
      ) OR (
        current_setting('shopsphere.actor_role', true) = 'seller'
        AND current_setting('shopsphere.operation', true) IN ('proposals.listingPublish', 'proposals.listingContentChange')
      )
    )
  );

-- 4. proposals INSERT: seller-role listing proposals may create rows for their
--    own subject only, exactly like the user-role cart branch.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND (
      (
        current_setting('shopsphere.actor_role', true) = 'user'
        AND current_setting('shopsphere.operation', true) = 'proposals.proposeCartChange'
      ) OR (
        current_setting('shopsphere.actor_role', true) = 'seller'
        AND current_setting('shopsphere.operation', true) IN ('proposals.listingPublish', 'proposals.listingContentChange')
      )
    )
  );

-- 5. listing_drafts: the publish preview reads the owned draft under the
--    proposal operation. Predicates verbatim from #20 plus the new operation.
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_seller ON listing_drafts;
CREATE POLICY shopsphere_assistant_listing_draft_seller ON listing_drafts
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN (
      'listings.draftCopy', 'listings.saveDraft', 'listings.listDrafts', 'listings.getDraft',
      'proposals.listingPublish'
    )
  );

-- 6. products: the content-change preview reads the owned product's current
--    allowlisted content and updatedAt. Predicate verbatim from the seller
--    catalog policy plus the new operation (cart/order/public branches and
--    every other table are untouched).
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary', 'proposals.listingContentChange')
  );
