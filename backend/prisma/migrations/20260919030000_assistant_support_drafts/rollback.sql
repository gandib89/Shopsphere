-- Rollback of 20260919030000_assistant_support_drafts (#19): restore the exact
-- pre-#19 buyer-order and buyer product policies and revoke the single column
-- grant this migration added. Run while no assistant runtime sessions are active.

REVOKE SELECT ("orderNumber") ON TABLE orders FROM shopsphere_assistant_private_runtime;

DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus')
  );

DROP POLICY IF EXISTS shopsphere_assistant_product_order ON products;
CREATE POLICY shopsphere_assistant_product_order ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders."productId" = products.id
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus')
  );
