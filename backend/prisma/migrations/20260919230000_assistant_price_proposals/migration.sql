-- Assistant seller price proposals for #27 (operation proposals.priceChange).
--
-- No new tables: propose_price_change writes the existing
-- proposals/proposal_outbox_events rows (column grants from 20260919050000
-- cover every projected column) and READS the seller's own product row for the
-- exact-state preview.
--
-- Role-predicate widening (documented deviation from "predicates verbatim"):
-- every earlier proposal class is buyer-authored, so the policies pinned
-- actor_role = 'user'. Price proposals are authored by sellers, so the role
-- predicate widens from = 'user' to IN ('user', 'seller'). Subject scoping is
-- unchanged and remains the isolation boundary; each pre-existing operation
-- keeps exactly its old behavior because the app layer already admits only
-- role "user" to those operations, and the seller role can now only reach RLS
-- rows through 'proposals.priceChange' (the seller-gated seller-catalog policy
-- below). The widening is also what lets the shared
-- enforceProposalCreationLimits pending-count read (which runs under the
-- caller's own operation GUC) see seller proposals at all.
--
-- Execution of an accepted proposal runs as the application owner through the
-- first-party browser endpoint, exactly as in #22/#24/#25, so no write path
-- for the assistant runtime is added here.

-- The proposals SELECT policy gains the new operation; the subjectId = actor
-- predicate is kept verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

-- The proposals INSERT policy gains the new operation; subject predicate
-- verbatim, same role widening as the SELECT policy.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

-- The seller-catalog products SELECT policy gains the new operation (the
-- preview reads the owned product's name, price, discount, and the updatedAt
-- version proxy); ownership + role predicates verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary', 'proposals.priceChange')
  );

-- The version proxy read: proposal creation snapshots products."updatedAt"
-- (added by migration 20260919215959_product_updated_at). GRANT is additive;
-- every other projected product column (id, name, price, discount, "sellerId")
-- was already granted by 20260916000000_assistant_buyer_seller_reads.
GRANT SELECT ("updatedAt")
  ON TABLE products TO shopsphere_assistant_private_runtime;
