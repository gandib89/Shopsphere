-- Assistant buyer/seller reads for #12/#13/#14 (PostgreSQL 16).
-- Restricted SELECT grants for the reviewed assistant projections plus
-- command-specific row-level security. Missing transaction-local actor context
-- resolves to no rows, except on the shared catalog tables where the public
-- catalog reads without actor context and keeps its current behavior.

-- Extend the public-catalog grants with the seller-private columns read only
-- under a sellerId = subject predicate.
GRANT SELECT ("sellerId", discount)
  ON TABLE products TO shopsphere_assistant_runtime;
GRANT SELECT (stock)
  ON TABLE product_options TO shopsphere_assistant_runtime;

-- Buyer cart projection: ownership and totals only, never the cart email.
GRANT SELECT (id, "userId", "totalPrice", "createdAt", "updatedAt")
  ON TABLE carts TO shopsphere_assistant_runtime;
GRANT SELECT (id, "cartId", "productId", quantity, price, variants, "addedAt")
  ON TABLE cart_items TO shopsphere_assistant_runtime;

-- Buyer order projection: immutable identity, status, money, timestamps, and
-- variants only. Names, emails, addresses, commissions, and promo linkage are
-- excluded. sellerIdAtPurchase is granted for quarantine visibility, never for
-- claiming legacy rows.
GRANT SELECT (id, "userId", "sellerIdAtPurchase", "orderGroupId", "productId",
              quantity, "totalPrice", status, "createdAt",
              "confirmedAt", "processingAt", "shippedAt", "deliveredAt", "cancelledAt",
              "variantStorage", "variantColor", "variantRam", "variantScreenSize", "variantProcessor")
  ON TABLE orders TO shopsphere_assistant_runtime;

-- Existing-bill projection: financial summary only, no names, contacts, or
-- delivery addresses.
GRANT SELECT (id, "orderId", "userId", "billNumber", "productName", quantity,
              "unitPrice", "totalPrice", status, "orderDate")
  ON TABLE bills TO shopsphere_assistant_runtime;

-- Payment/refund status projection: status and amount only, no gateway
-- references, payloads, provider ids, or idempotency keys.
GRANT SELECT (id, "orderId", "orderGroupId", amount, status, "createdAt", "updatedAt")
  ON TABLE payments TO shopsphere_assistant_runtime;
GRANT SELECT (id, "paymentId", "orderId", amount, status, "createdAt", "updatedAt")
  ON TABLE refunds TO shopsphere_assistant_runtime;

-- Promo validation projection: rules and counters for pure evaluation, never
-- the creator identity. Usage checks read the caller's own row only.
GRANT SELECT (id, code, description, "discountType", "discountValue", "minPurchase",
              "maxDiscount", "usageLimit", "usedCount", "validFrom", "validUntil", "isActive")
  ON TABLE promo_codes TO shopsphere_assistant_runtime;
GRANT SELECT ("promoCodeId", "userId")
  ON TABLE promo_code_usages TO shopsphere_assistant_runtime;

ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_cart_self ON carts;
CREATE POLICY shopsphere_assistant_cart_self ON carts
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_cart_item_self ON cart_items;
CREATE POLICY shopsphere_assistant_cart_item_self ON cart_items
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM carts
      WHERE carts.id = cart_items."cartId"
        AND carts."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus')
  );

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_bill_self ON bills;
CREATE POLICY shopsphere_assistant_bill_self ON bills
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'orders.getMyBillSummary'
  );

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_payment_buyer ON payments;
CREATE POLICY shopsphere_assistant_payment_buyer ON payments
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments."orderId"
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'orders.getMyPaymentStatus'
  );

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_refund_buyer ON refunds;
CREATE POLICY shopsphere_assistant_refund_buyer ON refunds
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = refunds."orderId"
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) = 'orders.getMyPaymentStatus'
  );

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_promo_validate ON promo_codes;
CREATE POLICY shopsphere_assistant_promo_validate ON promo_codes
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.validatePromo', 'cart.previewCheckout')
  );

ALTER TABLE promo_code_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_self ON promo_code_usages;
CREATE POLICY shopsphere_assistant_promo_usage_self ON promo_code_usages
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.validatePromo', 'cart.previewCheckout')
  );

-- Shared catalog tables: the public catalog reads through this same role
-- without actor context, so the first branch preserves its current behavior
-- bit-identically while every actor-context branch narrows to the rows one
-- fixed operation needs. In particular the seller-private columns granted
-- above (sellerId, discount, option stock) are reachable under actor context
-- only on owned, cart-contained, or self-ordered rows — never as a shared
-- pool any authenticated operation can enumerate.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_product_public ON products;
CREATE POLICY shopsphere_assistant_product_public ON products
  FOR SELECT TO shopsphere_assistant_runtime
  USING (current_setting('shopsphere.actor_id', true) IS NULL);
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary')
  );
DROP POLICY IF EXISTS shopsphere_assistant_product_cart ON products;
CREATE POLICY shopsphere_assistant_product_cart ON products
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM cart_items JOIN carts ON carts.id = cart_items."cartId"
      WHERE cart_items."productId" = products.id
        AND carts."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );
DROP POLICY IF EXISTS shopsphere_assistant_product_order ON products;
CREATE POLICY shopsphere_assistant_product_order ON products
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders."productId" = products.id
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus')
  );

ALTER TABLE product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_options FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_option_public ON product_options;
CREATE POLICY shopsphere_assistant_option_public ON product_options
  FOR SELECT TO shopsphere_assistant_runtime
  USING (current_setting('shopsphere.actor_id', true) IS NULL);
DROP POLICY IF EXISTS shopsphere_assistant_option_seller ON product_options;
CREATE POLICY shopsphere_assistant_option_seller ON product_options
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = product_options."productId"
        AND products."sellerId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary')
  );
DROP POLICY IF EXISTS shopsphere_assistant_option_cart ON product_options;
CREATE POLICY shopsphere_assistant_option_cart ON product_options
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    EXISTS (
      SELECT 1 FROM products
      JOIN cart_items ON cart_items."productId" = products.id
      JOIN carts ON carts.id = cart_items."cartId"
      WHERE products.id = product_options."productId"
        AND carts."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('cart.getMine', 'cart.validatePromo', 'cart.previewCheckout')
  );

-- FORCE RLS also applies to the table owner. Preserve the existing
-- application path explicitly while keeping the restricted runtime subject to
-- its policies.
DO $$
DECLARE
  owner_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['carts', 'cart_items', 'orders', 'bills', 'payments', 'refunds', 'promo_codes', 'promo_code_usages', 'products', 'product_options']
  LOOP
    SELECT tableowner INTO owner_name
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = table_name;
    EXECUTE format('DROP POLICY IF EXISTS shopsphere_application_owner ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY shopsphere_application_owner ON %I TO %I USING (true) WITH CHECK (true)',
      table_name, owner_name
    );
  END LOOP;
END
$$;
