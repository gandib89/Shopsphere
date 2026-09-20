-- Rollback of 20260919240000_assistant_inventory_proposals (#28).
--
-- Restores the exact policy definitions that were in force before this
-- migration — the #27 state (20260919230000_assistant_price_proposals plus
-- 20260916000000_assistant_buyer_seller_reads) — removing only the
-- 'proposals.inventoryAdjust' operation from the four affected policies. Run
-- while no assistant runtime sessions are active. No grants were added by
-- this migration, so nothing is revoked here.

-- 1. proposals SELECT back to the #27 definition.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

-- 2. proposals INSERT back to the #27 definition.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange')
  );

-- 3. products back to the #27 definition.
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary', 'proposals.priceChange')
  );

-- 4. product_options back to the 20260916000000 definition.
DROP POLICY IF EXISTS shopsphere_assistant_option_seller ON product_options;
CREATE POLICY shopsphere_assistant_option_seller ON product_options
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = product_options."productId"
        AND products."sellerId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary')
  );
