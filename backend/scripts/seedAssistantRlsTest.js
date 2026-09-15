import pg from "pg";

const { Pool } = pg;
if (process.env.RUN_POSTGRES_INTEGRATION !== "true") {
  throw new Error("RUN_POSTGRES_INTEGRATION=true is required for the RLS test seed");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(`
    INSERT INTO users (id, "firstName", "lastName", email, role, "isVerified") VALUES
      ('aaaaaaaaaaaaaaaaaaaaaaaa', 'Ada', 'Buyer', 'rls-a@example.test', 'user', true),
      ('bbbbbbbbbbbbbbbbbbbbbbbb', 'Ben', 'Seller', 'rls-b@example.test', 'seller', false)
    ON CONFLICT (id) DO UPDATE SET
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      role = EXCLUDED.role,
      "isVerified" = EXCLUDED."isVerified"
  `);
  await pool.query(`
    INSERT INTO notifications (id, "userId", type, title, message, read, "createdAt") VALUES
      ('111111111111111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'order', 'Ada notice', 'Owned by Ada', false, now()),
      ('222222222222222222222222', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'order', 'Ben notice', 'Owned by Ben', false, now())
    ON CONFLICT (id) DO NOTHING
  `);
  // Buyer/seller read fixtures for #12/#13/#14: a second buyer (Cid), Ben's
  // product, Ada's cart and order, Cid's order, and a legacy order plus a
  // legacy bill whose NULL buyer ownership quarantines them from assistant
  // reads. Additive only: existing Ada/Ben rows are untouched.
  await pool.query(`
    INSERT INTO users (id, "firstName", "lastName", email, role, "isVerified") VALUES
      ('cccccccccccccccccccccccc', 'Cid', 'Buyer', 'rls-c@example.test', 'user', true),
      ('dddddddddddddddddddddddd', 'Eve', 'Buyer', 'rls-e@example.test', 'user', true)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO products (id, name, price, quantity, category, "sellerId") VALUES
      ('d1d1d1d1d1d1d1d1d1d1d1d1', 'RLS Lamp', 49.99, 8, 'Home', 'bbbbbbbbbbbbbbbbbbbbbbbb')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO product_options (id, "productId", kind, value, "priceDelta", stock) VALUES
      ('rls-option-1', 'd1d1d1d1d1d1d1d1d1d1d1d1', 'color', 'Red', 5.00, 4)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO carts (id, "userId", email, "totalPrice") VALUES
      ('e2e2e2e2e2e2e2e2e2e2e2e2', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'rls-a@example.test', 49.99)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO cart_items (id, "cartId", "productId", quantity, price, variants) VALUES
      ('rls-cart-item-1', 'e2e2e2e2e2e2e2e2e2e2e2e2', 'd1d1d1d1d1d1d1d1d1d1d1d1', 1, 54.99, '{}')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO orders (id, "firstName", "lastName", "productId", quantity, "deliveryDate", email, "totalPrice", status, "userId", "sellerIdAtPurchase") VALUES
      ('f3f3f3f3f3f3f3f3f3f3f3f3', 'Ada', 'Buyer', 'd1d1d1d1d1d1d1d1d1d1d1d1', 1, now(), 'rls-a@example.test', 54.99, 'Shipped', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'),
      ('b5b5b5b5b5b5b5b5b5b5b5b5', 'Cid', 'Buyer', 'd1d1d1d1d1d1d1d1d1d1d1d1', 2, now(), 'rls-c@example.test', 109.98, 'Pending', 'cccccccccccccccccccccccc', 'bbbbbbbbbbbbbbbbbbbbbbbb'),
      ('a4a4a4a4a4a4a4a4a4a4a4a4', 'Legacy', 'Row', 'd1d1d1d1d1d1d1d1d1d1d1d1', 1, now(), 'legacy@example.test', 54.99, 'Delivered', NULL, NULL)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO bills (id, "orderId", "userId", "productId", "billNumber", "productName", quantity, "unitPrice", "totalPrice", status) VALUES
      ('c6c6c6c6c6c6c6c6c6c6c6c6', 'f3f3f3f3f3f3f3f3f3f3f3f3', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'd1d1d1d1d1d1d1d1d1d1d1d1', 'BILL-f3f3f3f3f3f3f3f3f3f3f3f3', 'RLS Lamp', 1, 54.99, 54.99, 'Generated'),
      ('d7d7d7d7d7d7d7d7d7d7d7d7', 'a4a4a4a4a4a4a4a4a4a4a4a4', NULL, 'd1d1d1d1d1d1d1d1d1d1d1d1', 'BILL-a4a4a4a4a4a4a4a4a4a4a4a4', 'RLS Lamp', 1, 54.99, 54.99, 'Generated')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO payments (id, "orderId", "transactionUuid", "productCode", amount, status) VALUES
      ('e8e8e8e8e8e8e8e8e8e8e8e8', 'f3f3f3f3f3f3f3f3f3f3f3f3', 'rls-txn-1', 'EPAY', 54.99, 'Succeeded')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO promo_codes (id, code, description, "discountType", "discountValue", "createdById", "validFrom", "validUntil", "isActive") VALUES
      ('f9f9f9f9f9f9f9f9f9f9f9f9', 'RLS10', 'RLS fixture promo', 'percentage', 10, 'aaaaaaaaaaaaaaaaaaaaaaaa', now() - interval '1 day', now() + interval '30 days', true),
      ('a1a1a1a1a1a1a1a1a1a1a1a1', 'RLS11', 'RLS unused fixture promo', 'percentage', 15, 'aaaaaaaaaaaaaaaaaaaaaaaa', now() - interval '1 day', now() + interval '30 days', true)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO promo_code_usages ("promoCodeId", "userId") VALUES
      ('f9f9f9f9f9f9f9f9f9f9f9f9', 'aaaaaaaaaaaaaaaaaaaaaaaa')
    ON CONFLICT DO NOTHING
  `);
} finally {
  await pool.end();
}
