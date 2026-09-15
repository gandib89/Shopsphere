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
} finally {
  await pool.end();
}
