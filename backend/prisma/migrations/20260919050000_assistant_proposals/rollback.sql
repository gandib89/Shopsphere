-- Rollback of 20260919050000_assistant_proposals. Run while no assistant
-- runtime sessions are active. Restores the pre-#22 cart policies verbatim.

DROP POLICY IF EXISTS shopsphere_assistant_cart_item_self ON cart_items;
CREATE POLICY shopsphere_assistant_cart_item_self ON cart_items
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM carts
      WHERE carts.id = cart_items."cartId"
        AND carts."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );

DROP POLICY IF EXISTS shopsphere_assistant_cart_self ON carts;
CREATE POLICY shopsphere_assistant_cart_self ON carts
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );

DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
DROP POLICY IF EXISTS shopsphere_application_owner ON proposals;
ALTER TABLE proposals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE proposals DISABLE ROW LEVEL SECURITY;
REVOKE SELECT ON TABLE proposals FROM shopsphere_assistant_private_runtime;
REVOKE INSERT ON TABLE proposals FROM shopsphere_assistant_private_runtime;

DROP TRIGGER IF EXISTS proposal_outbox_events_append_only ON proposal_outbox_events;
DROP FUNCTION IF EXISTS shopsphere_reject_outbox_mutation();
DROP TABLE IF EXISTS proposal_outbox_events;

DROP TRIGGER IF EXISTS proposals_payload_immutable ON proposals;
DROP FUNCTION IF EXISTS shopsphere_reject_proposal_payload_mutation();
DROP TABLE IF EXISTS proposals;
