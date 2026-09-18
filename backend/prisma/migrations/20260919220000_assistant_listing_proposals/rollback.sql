-- Manual rollback for #26. Run while no assistant runtime sessions are active.
-- Restores the pre-#26 policy definitions verbatim (from migrations
-- 20260919050000_assistant_proposals, 20260919040000_assistant_listing_drafts,
-- and 20260916000000_assistant_buyer_seller_reads) and revokes exactly the two
-- grants this migration added. No table, column, trigger, or role is dropped.

-- 1. Reverse the two new grants.
REVOKE SELECT ("updatedAt")
  ON TABLE products FROM shopsphere_assistant_private_runtime;
REVOKE INSERT (id, "proposalId", "eventType", "payloadHash", "occurredAt")
  ON TABLE proposal_outbox_events FROM shopsphere_assistant_private_runtime;

-- 2. proposals SELECT: back to the #22 user-role-only definition.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus')
  );

-- 3. proposals INSERT: back to the #22 user-role-only definition.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'proposals.proposeCartChange'
  );

-- 4. listing_drafts SELECT: back to the #20 draft operations.
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_seller ON listing_drafts;
CREATE POLICY shopsphere_assistant_listing_draft_seller ON listing_drafts
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN (
      'listings.draftCopy', 'listings.saveDraft', 'listings.listDrafts', 'listings.getDraft'
    )
  );

-- 5. products seller SELECT: back to the catalog operations.
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary')
  );
