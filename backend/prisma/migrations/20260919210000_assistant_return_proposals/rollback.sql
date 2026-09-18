-- Rollback of 20260919210000_assistant_return_proposals (run while no assistant
-- runtime sessions are active). Restores the exact policy definitions that
-- existed before this migration (i.e. the state after migrations
-- 20260919000000..20260919050001, without the proposals.orderReturn operation)
-- and revokes the single column grant this migration added.

REVOKE SELECT ("updatedAt") ON TABLE orders FROM shopsphere_assistant_private_runtime;

DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus')
  );

DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'proposals.proposeCartChange'
  );

DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus', 'support.draftMessage')
  );
