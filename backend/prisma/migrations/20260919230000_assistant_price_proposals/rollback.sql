-- Rollback of 20260919230000_assistant_price_proposals (run while no assistant
-- runtime sessions are active). Restores the exact prior policy definitions
-- (from 20260919210000_assistant_return_proposals and
-- 20260916000000_assistant_buyer_seller_reads) and revokes the single column
-- grant this migration added. Pending proposals.priceChange rows become
-- unreadable under RLS (they stay pending until expiry) and must be resolved
-- before this rollback if that matters operationally.

-- Restore the buyer-only role pin and the pre-#27 operation list.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn')
  );

DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn')
  );

DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary')
  );

REVOKE SELECT ("updatedAt") ON TABLE products FROM shopsphere_assistant_private_runtime;
