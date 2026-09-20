-- Rollback of 20260919200000_assistant_order_cancel_proposals (#24).
-- Restores the prior policy definitions verbatim (pre-#24 operation lists)
-- and revokes exactly the two order columns this migration granted. Run only
-- while no assistant runtime sessions are active.

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
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus')
  );

DROP POLICY IF EXISTS shopsphere_assistant_payment_buyer ON payments;
CREATE POLICY shopsphere_assistant_payment_buyer ON payments
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments."orderId"
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'orders.getMyPaymentStatus'
  );

REVOKE SELECT ("orderNumber", "updatedAt")
  ON TABLE orders FROM shopsphere_assistant_private_runtime;
