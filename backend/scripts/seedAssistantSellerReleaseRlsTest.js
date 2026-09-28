import pg from "pg";

if (process.env.RUN_POSTGRES_INTEGRATION !== "true") throw new Error("PostgreSQL integration required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(`
    UPDATE users SET "isVerified" = true WHERE id IN ('bbbbbbbbbbbbbbbbbbbbbbbb', 'eeeeeeeeeeeeeeeeeeeeeeee');
    INSERT INTO users (id, "firstName", "lastName", email, role, "isVerified") VALUES
      ('ffffffffffffffffffffffff', 'Una', 'Seller', 'rls-unverified@example.test', 'seller', false)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO products (id, name, price, quantity, category, "sellerId", "isArchived") VALUES
      ('d3d3d3d3d3d3d3d3d3d3d3d3', 'RLS Archived Lamp', 19.99, 1, 'Home', 'bbbbbbbbbbbbbbbbbbbbbbbb', true)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO product_options (id, "productId", kind, value, "priceDelta", stock) VALUES
      ('rls-foreign-option-32', 'd2d2d2d2d2d2d2d2d2d2d2d2', 'color', 'Blue', 0.00, 97)
    ON CONFLICT (id) DO NOTHING;
    UPDATE orders SET "firstName" = 'CANARY-BUYER-NAME-32',
      email = 'canary-buyer-email-32@example.test', "deliveryStreet" = 'CANARY-BUYER-ADDRESS-32'
    WHERE id = 'f4f4f4f4f4f4f4f4f4f4f4f4';
    INSERT INTO revenues (id, "orderId", "sellerId", "productId", "totalSalePrice", "adminCommission",
                          "sellerRevenue", quantity, month, year, status) VALUES
      ('a2a2a2a2a2a2a2a2a2a2a2a2', 'f4f4f4f4f4f4f4f4f4f4f4f4', 'bbbbbbbbbbbbbbbbbbbbbbbb',
       'd2d2d2d2d2d2d2d2d2d2d2d2', 0.00, 0.00, 0.00, 1, 9, 2026, 'Refunded'),
      ('a3a3a3a3a3a3a3a3a3a3a3a3', 'f5f5f5f5f5f5f5f5f5f5f5f5', 'eeeeeeeeeeeeeeeeeeeeeeee',
       'd2d2d2d2d2d2d2d2d2d2d2d2', 39.99, 3.99, 36.00, 1, 9, 2026, 'Completed'),
      ('a5a5a5a5a5a5a5a5a5a5a5a5', 'f6f6f6f6f6f6f6f6f6f6f6f6', 'bbbbbbbbbbbbbbbbbbbbbbbb',
       'd1d1d1d1d1d1d1d1d1d1d1d1', 49.99, 5.00, 44.99, 1, 9, 2026, 'Completed')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO payments (id, "orderId", "transactionUuid", "productCode", amount, status, "updatedAt") VALUES
      ('b2b2b2b2b2b2b2b2b2b2b2b2', 'f4f4f4f4f4f4f4f4f4f4f4f4', 'rls-refund-txn-32', 'EPAY', 39.99, 'Succeeded', now())
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO refunds (id, "paymentId", "orderId", amount, status, mode, "idempotencyKey", "completedAt", "updatedAt") VALUES
      ('b3b3b3b3b3b3b3b3b3b3b3b3', 'b2b2b2b2b2b2b2b2b2b2b2b2',
       'f4f4f4f4f4f4f4f4f4f4f4f4', 39.99, 'Succeeded', 'sandbox', 'rls-refund-key-32',
       '2026-09-15 00:00:00+00', now())
    ON CONFLICT (id) DO NOTHING;
  `);
} finally {
  await pool.end();
}
