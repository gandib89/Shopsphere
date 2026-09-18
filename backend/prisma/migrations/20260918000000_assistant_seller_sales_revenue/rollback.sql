-- Manual rollback for #15. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_revenue_seller ON revenues;
DROP POLICY IF EXISTS shopsphere_assistant_order_seller ON orders;
DROP POLICY IF EXISTS shopsphere_assistant_refund_seller ON refunds;
DROP POLICY IF EXISTS shopsphere_assistant_product_sale ON products;
ALTER TABLE revenues NO FORCE ROW LEVEL SECURITY;
ALTER TABLE revenues DISABLE ROW LEVEL SECURITY;
-- Revenues: this migration introduced the whole grant, so revoke every column.
REVOKE SELECT (id, "orderId", "sellerId", "totalSalePrice", "adminCommission",
               "sellerRevenue", status, month, year)
  ON TABLE revenues FROM shopsphere_assistant_private_runtime;
-- Refunds: only the completedAt column was added; the pre-existing
-- get_my_payment_status columns must keep their grants.
REVOKE SELECT ("completedAt")
  ON TABLE refunds FROM shopsphere_assistant_private_runtime;
DROP POLICY IF EXISTS shopsphere_application_owner ON revenues;
