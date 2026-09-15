import pg from "pg";

const { Pool } = pg;
const password = process.env.ASSISTANT_DB_PASSWORD;
if (!password || password.length < 24 || password.includes("\0")) {
  throw new Error("ASSISTANT_DB_PASSWORD must contain at least 24 characters and no NUL bytes");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to provision the assistant role");

const quotedPassword = `'${password.replaceAll("'", "''")}'`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(`ALTER ROLE shopsphere_assistant_runtime LOGIN PASSWORD ${quotedPassword}`);
  const { rows: [role] } = await pool.query(
    "SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = 'shopsphere_assistant_runtime'",
  );
  if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.rolbypassrls) {
    throw new Error("Assistant database role does not have the required restricted attributes");
  }
} finally {
  await pool.end();
}
