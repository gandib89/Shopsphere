import pg from "pg";

const { Pool } = pg;
const password = process.env.ASSISTANT_DB_PASSWORD;
const privatePassword = process.env.ASSISTANT_PRIVATE_DB_PASSWORD;
if (!password || password.length < 24 || password.includes("\0")) {
  throw new Error("ASSISTANT_DB_PASSWORD must contain at least 24 characters and no NUL bytes");
}
if (!privatePassword || privatePassword.length < 24 || privatePassword.includes("\0")) {
  throw new Error("ASSISTANT_PRIVATE_DB_PASSWORD must contain at least 24 characters and no NUL bytes");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to provision the assistant role");

const quotedPassword = `'${password.replaceAll("'", "''")}'`;
const quotedPrivatePassword = `'${privatePassword.replaceAll("'", "''")}'`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(`ALTER ROLE shopsphere_assistant_runtime LOGIN PASSWORD ${quotedPassword}`);
  await pool.query(`ALTER ROLE shopsphere_assistant_private_runtime LOGIN PASSWORD ${quotedPrivatePassword}`);
  const { rows: roles } = await pool.query(
    "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls FROM pg_roles WHERE rolname IN ('shopsphere_assistant_runtime', 'shopsphere_assistant_private_runtime') ORDER BY rolname",
  );
  const publicRole = roles.find(({ rolname }) => rolname === "shopsphere_assistant_runtime");
  const privateRole = roles.find(({ rolname }) => rolname === "shopsphere_assistant_private_runtime");
  if (!publicRole || publicRole.rolsuper || publicRole.rolcreatedb || publicRole.rolcreaterole || publicRole.rolinherit || publicRole.rolbypassrls) {
    throw new Error("Assistant database role does not have the required restricted attributes");
  }
  if (!privateRole || privateRole.rolsuper || privateRole.rolcreatedb || privateRole.rolcreaterole || privateRole.rolinherit || privateRole.rolbypassrls) {
    throw new Error("Private assistant database role does not have the required restricted attributes");
  }
} finally {
  await pool.end();
}
