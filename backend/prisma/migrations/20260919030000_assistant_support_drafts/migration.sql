-- Buyer support-message drafting for #19 (operation support.draftMessage).
-- The draft reads the buyer-owned order's number in addition to the columns
-- the buyer reads already grant. Everything else it renders (status, createdAt,
-- quantity, fulfilment milestone timestamps, and product.name through the
-- order→product join) is already granted to shopsphere_assistant_private_runtime
-- by 20260916000000_assistant_buyer_seller_reads, so the only new grant is the
-- column this projection actually reads that was not granted yet.

GRANT SELECT ("orderNumber") ON TABLE orders TO shopsphere_assistant_private_runtime;

-- Admit the draft operation to the existing buyer-order policy. Ownership
-- predicate and role check are unchanged; only the operation list grows.
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus', 'support.draftMessage')
  );

-- The draft resolves the ordered product's name through the order→product
-- join, which runs under the same operation context, so the buyer product
-- policy must admit the operation too. Ownership predicate unchanged.
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
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus', 'support.draftMessage')
  );
