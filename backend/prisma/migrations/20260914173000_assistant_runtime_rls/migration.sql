-- Restricted assistant runtime for #9 (PostgreSQL 16).
-- The role starts NOLOGIN; deployment supplies its password out-of-band after
-- migrations so no credential is committed to source control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shopsphere_assistant_runtime') THEN
    CREATE ROLE shopsphere_assistant_runtime NOLOGIN;
  END IF;
END
$$;

ALTER ROLE shopsphere_assistant_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM shopsphere_assistant_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO shopsphere_assistant_runtime', current_database());
END
$$;
REVOKE ALL ON SCHEMA public FROM shopsphere_assistant_runtime;
GRANT USAGE ON SCHEMA public TO shopsphere_assistant_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM shopsphere_assistant_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM shopsphere_assistant_runtime;

-- Public catalog projections: only columns reviewed by assistantPublicCatalog.
GRANT SELECT (id, name, price, images, category, quantity, description,
              "variantColor", "variantStorage", "isArchived", "createdAt")
  ON TABLE products TO shopsphere_assistant_runtime;
GRANT SELECT ("productId", kind, value, "priceDelta")
  ON TABLE product_options TO shopsphere_assistant_runtime;
GRANT SELECT (id, "productId", "userName", rating, comment, "createdAt")
  ON TABLE product_reviews TO shopsphere_assistant_runtime;

-- Private profile projection: RLS is defense in depth over the application id
-- predicate. Missing transaction-local context resolves to no rows.
GRANT SELECT (id, "firstName", "lastName", role, "isVerified")
  ON TABLE users TO shopsphere_assistant_runtime;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopsphere_assistant_user_self ON users;
CREATE POLICY shopsphere_assistant_user_self ON users
  FOR SELECT TO shopsphere_assistant_runtime
  USING (
    id = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller', 'admin')
    AND nullif(current_setting('shopsphere.operation', true), '') IS NOT NULL
  );

-- FORCE RLS also applies to the table owner. Preserve the existing application
-- path explicitly while keeping the restricted runtime subject to its policy.
DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT tableowner INTO owner_name
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'users';
  DROP POLICY IF EXISTS shopsphere_application_owner ON users;
  EXECUTE format(
    'CREATE POLICY shopsphere_application_owner ON users TO %I USING (true) WITH CHECK (true)',
    owner_name
  );
END
$$;
