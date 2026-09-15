-- Manual rollback for #12/#13/#14. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_cart_self ON carts;
DROP POLICY IF EXISTS shopsphere_assistant_cart_item_self ON cart_items;
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
DROP POLICY IF EXISTS shopsphere_assistant_bill_self ON bills;
DROP POLICY IF EXISTS shopsphere_assistant_payment_buyer ON payments;
DROP POLICY IF EXISTS shopsphere_assistant_refund_buyer ON refunds;
DROP POLICY IF EXISTS shopsphere_assistant_promo_validate ON promo_codes;
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_self ON promo_code_usages;
DROP POLICY IF EXISTS shopsphere_application_owner ON carts;
DROP POLICY IF EXISTS shopsphere_application_owner ON cart_items;
DROP POLICY IF EXISTS shopsphere_application_owner ON orders;
DROP POLICY IF EXISTS shopsphere_application_owner ON bills;
DROP POLICY IF EXISTS shopsphere_application_owner ON payments;
DROP POLICY IF EXISTS shopsphere_application_owner ON refunds;
DROP POLICY IF EXISTS shopsphere_application_owner ON promo_codes;
DROP POLICY IF EXISTS shopsphere_application_owner ON promo_code_usages;
ALTER TABLE carts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE carts DISABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cart_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE bills NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE refunds NO FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds DISABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_codes DISABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE carts, cart_items, orders, bills, payments, refunds, promo_codes, promo_code_usages
  FROM shopsphere_assistant_runtime;
-- Restore the pre-#12 column grants on the shared catalog tables.
REVOKE ALL ON TABLE products, product_options FROM shopsphere_assistant_runtime;
GRANT SELECT (id, name, price, images, category, quantity, description,
              "variantColor", "variantStorage", "isArchived", "createdAt")
  ON TABLE products TO shopsphere_assistant_runtime;
GRANT SELECT ("productId", kind, value, "priceDelta")
  ON TABLE product_options TO shopsphere_assistant_runtime;
