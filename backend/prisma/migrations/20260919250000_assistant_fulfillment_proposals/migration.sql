-- Assistant seller fulfillment-transition proposals for #29 (PostgreSQL 16).
--
-- Extends the #22 proposal platform with the "proposals.fulfillmentTransition"
-- operation. No new tables: propose_fulfillment_transition writes the existing
-- proposals/proposal_outbox_events rows (column grants from 20260919050000 and
-- 20260919220000 cover every projected column) and READS the seller's own sale
-- line (an Order row attributed via the immutable "sellerIdAtPurchase") plus
-- the sold product's name for the exact-state preview.
--
-- Predicate and role semantics are unchanged from the current merged chain
-- (20260919230000_assistant_price_proposals): the subjectId = actor scoping is
-- verbatim, the role predicate stays IN ('user', 'seller'), and the operation
-- IN lists gain 'proposals.fulfillmentTransition'. The seller-role branch is
-- what admits both the preview read and the shared
-- enforceProposalCreationLimits pending-count (which runs under this
-- operation's GUC). Execution of an accepted proposal runs as the application
-- owner through the first-party browser endpoint, exactly as in
-- #22/#24/#25/#26/#27, so no write path for the assistant runtime is added
-- here.

-- The proposals SELECT policy gains the new operation; subject + role
-- predicates verbatim from the current merged chain.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange', 'proposals.fulfillmentTransition')
  );

-- The proposals INSERT policy gains the new operation; predicates verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange', 'proposals.fulfillmentTransition')
  );

-- The seller-side orders SELECT policy gains the new operation: the preview
-- reads the seller's own sale line under the immutable sellerIdAtPurchase
-- attribution (never current product ownership). Ownership + role predicates
-- verbatim from 20260918000000_assistant_seller_sales_revenue.
DROP POLICY IF EXISTS shopsphere_assistant_order_seller ON orders;
CREATE POLICY shopsphere_assistant_order_seller ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerIdAtPurchase" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine', 'sales.revenueSummary', 'proposals.fulfillmentTransition')
  );

-- The sold-product name join follows the historical attribution: the preview
-- reads the product name through the sold row, so the row scope stays with the
-- seller-at-purchase line (a product whose ownership later transferred stays
-- reachable for the name only). Policy from 20260918000000 plus the new
-- operation; predicates verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_product_sale ON products;
CREATE POLICY shopsphere_assistant_product_sale ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders."productId" = products.id
        AND orders."sellerIdAtPurchase" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine', 'proposals.fulfillmentTransition')
  );

-- No new column grants: every column the preview projects was already granted
-- to shopsphere_assistant_private_runtime — orders id/status/orderNumber/
-- confirmedAt/processingAt/shippedAt/deliveredAt by 20260916000000 and
-- 20260919010000, orders."updatedAt" (the version proxy) by
-- 20260919210000_assistant_return_proposals, and products.name by
-- 20260916000000. The assistant runtime still has no UPDATE/DELETE grant on
-- orders anywhere: the live transition happens only through the first-party
-- owner path.
