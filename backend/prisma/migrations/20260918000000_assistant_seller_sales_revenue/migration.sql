-- Assistant seller sale-line and revenue reads for #15 (PostgreSQL 16).
-- Sale lines authorize through the immutable Order.sellerIdAtPurchase snapshot
-- (legacy NULL-attribution rows resolve to no rows); the revenue ledger
-- authorizes through Revenue.sellerId as captured at sale creation; refund
-- buckets authorize through the sold order's attribution. Missing
-- transaction-local actor context resolves to no rows.

-- Revenue projection: ledger amounts and bucket keys only — no admin identity.
-- sellerId, createdAt, and id are granted because the operation predicates and
-- ordering reference them; productId, quantity, transactionDate, and adminId
-- stay unread.
GRANT SELECT (id, "orderId", "sellerId", "totalSalePrice", "adminCommission",
              "sellerRevenue", status, month, year, "createdAt")
  ON TABLE revenues TO shopsphere_assistant_private_runtime;

-- Refund bucket projection adds the completion timestamp to the already
-- granted status/amount columns; provider references and idempotency keys
-- remain unread.
GRANT SELECT (id, "orderId", amount, status, "completedAt", "createdAt")
  ON TABLE refunds TO shopsphere_assistant_private_runtime;

ALTER TABLE revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_revenue_seller ON revenues;
CREATE POLICY shopsphere_assistant_revenue_seller ON revenues
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine', 'sales.revenueSummary')
  );

DROP POLICY IF EXISTS shopsphere_assistant_order_seller ON orders;
CREATE POLICY shopsphere_assistant_order_seller ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerIdAtPurchase" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('sales.listMine', 'sales.getMine', 'sales.revenueSummary')
  );

-- Refund rows carry no seller column, so they are scoped through the
-- attributed order. The orders policy above admits the seller's rows during
-- sales.revenueSummary, which is what makes this EXISTS resolvable.
DROP POLICY IF EXISTS shopsphere_assistant_refund_seller ON refunds;
CREATE POLICY shopsphere_assistant_refund_seller ON refunds
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = refunds."orderId"
        AND orders."sellerIdAtPurchase" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) = 'sales.revenueSummary'
  );

-- Sale lines display the product name via the sold row, so a product whose
-- ownership later transferred stays readable (name only) through the
-- historical attribution, never through current Product.sellerId.
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

-- FORCE RLS also applies to the table owner. Preserve the existing
-- application path explicitly.
DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT tableowner INTO owner_name
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'revenues';
  DROP POLICY IF EXISTS shopsphere_application_owner ON revenues;
  EXECUTE format(
    'CREATE POLICY shopsphere_application_owner ON revenues TO %I USING (true) WITH CHECK (true)',
    owner_name
  );
END
$$;
