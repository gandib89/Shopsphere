-- Manual rollback for #15. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_revenue_seller ON revenues;
DROP POLICY IF EXISTS shopsphere_assistant_order_seller ON orders;
DROP POLICY IF EXISTS shopsphere_assistant_refund_seller ON refunds;
DROP POLICY IF EXISTS shopsphere_assistant_product_sale ON products;
ALTER TABLE revenues NO FORCE ROW LEVEL SECURITY;
ALTER TABLE revenues DISABLE ROW LEVEL SECURITY;
REVOKE SELECT (id, "orderId", "sellerId", "totalSalePrice", "adminCommission",
               "sellerRevenue", status, month, year, "createdAt")
  ON TABLE revenues FROM shopsphere_assistant_private_runtime;
REVOKE SELECT (id, "orderId", amount, status, "completedAt", "createdAt")
  ON TABLE refunds FROM shopsphere_assistant_private_runtime;
DROP POLICY IF EXISTS shopsphere_application_owner ON revenues;
