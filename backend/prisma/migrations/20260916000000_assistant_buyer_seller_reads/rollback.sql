-- Manual rollback for #12/#13/#14. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_cart_self ON carts;
DROP POLICY IF EXISTS shopsphere_assistant_cart_item_self ON cart_items;
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
DROP POLICY IF EXISTS shopsphere_assistant_bill_self ON bills;
DROP POLICY IF EXISTS shopsphere_assistant_payment_buyer ON payments;
DROP POLICY IF EXISTS shopsphere_assistant_refund_buyer ON refunds;
DROP POLICY IF EXISTS shopsphere_assistant_promo_validate ON promo_codes;
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_self ON promo_code_usages;
DROP POLICY IF EXISTS shopsphere_assistant_product_public ON products;
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
DROP POLICY IF EXISTS shopsphere_assistant_product_cart ON products;
DROP POLICY IF EXISTS shopsphere_assistant_product_order ON products;
DROP POLICY IF EXISTS shopsphere_assistant_option_public ON product_options;
DROP POLICY IF EXISTS shopsphere_assistant_option_seller ON product_options;
DROP POLICY IF EXISTS shopsphere_assistant_option_cart ON product_options;
DROP POLICY IF EXISTS shopsphere_application_owner ON carts;
DROP POLICY IF EXISTS shopsphere_application_owner ON cart_items;
DROP POLICY IF EXISTS shopsphere_application_owner ON orders;
DROP POLICY IF EXISTS shopsphere_application_owner ON bills;
DROP POLICY IF EXISTS shopsphere_application_owner ON payments;
DROP POLICY IF EXISTS shopsphere_application_owner ON refunds;
DROP POLICY IF EXISTS shopsphere_application_owner ON promo_codes;
DROP POLICY IF EXISTS shopsphere_application_owner ON promo_code_usages;
DROP POLICY IF EXISTS shopsphere_application_owner ON products;
DROP POLICY IF EXISTS shopsphere_application_owner ON product_options;
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
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_options NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_options DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE carts, cart_items, orders, bills, payments, refunds, promo_codes,
  promo_code_usages, products, product_options FROM shopsphere_assistant_private_runtime;
REVOKE SELECT (id, "firstName", "lastName", role, "isVerified")
  ON users FROM shopsphere_assistant_private_runtime;
REVOKE SELECT (id, "userId", type, title, message, read, "productId", "productName", "createdAt")
  ON notifications FROM shopsphere_assistant_private_runtime;
REVOKE INSERT ON assistant_audit_events FROM shopsphere_assistant_private_runtime;
GRANT SELECT (id, "firstName", "lastName", role, "isVerified")
  ON TABLE users TO shopsphere_assistant_runtime;
GRANT SELECT (id, "userId", type, title, message, read, "productId", "productName", "createdAt")
  ON TABLE notifications TO shopsphere_assistant_runtime;
GRANT INSERT ON assistant_audit_events TO shopsphere_assistant_runtime;
DROP POLICY IF EXISTS shopsphere_assistant_user_self ON users;
CREATE POLICY shopsphere_assistant_user_self ON users
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    id = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller', 'admin')
    AND NULLIF(current_setting('shopsphere.operation', true), '') IS NOT NULL
  );
DROP POLICY IF EXISTS shopsphere_assistant_notification_self ON notifications;
CREATE POLICY shopsphere_assistant_notification_self ON notifications
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller', 'admin')
    AND current_setting('shopsphere.operation', true) = 'notifications.listMine'
  );
DROP OWNED BY shopsphere_assistant_private_runtime;
DROP ROLE IF EXISTS shopsphere_assistant_private_runtime;
