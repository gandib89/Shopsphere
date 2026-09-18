-- Rollback of 20260919250000_assistant_fulfillment_proposals (run while no
-- assistant runtime sessions are active). Restores the exact prior policy
-- definitions (from 20260919230000_assistant_price_proposals,
-- 20260918000000_assistant_seller_sales_revenue, and the buyer/seller reads
-- chain) verbatim. No column grants were added by this migration, so nothing
-- is revoked. Pending proposals.fulfillmentTransition rows become unreadable
-- under RLS (they stay pending until expiry) and must be resolved before this
-- rollback if that matters operationally.

-- Restore the pre-#29 operation lists (role predicate IN ('user', 'seller')).
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

DROP POLICY IF EXISTS shopsphere_assistant_order_seller ON orders;
CREATE POLICY shopsphere_assistant_order_seller ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerIdAtPurchase" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine', 'sales.revenueSummary')
  );

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
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine')
  );
