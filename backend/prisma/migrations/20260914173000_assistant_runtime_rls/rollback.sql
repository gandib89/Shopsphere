-- Manual rollback for #9. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_user_self ON users;
DROP POLICY IF EXISTS shopsphere_application_owner ON users;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE users, products, product_options, product_reviews
  FROM shopsphere_assistant_runtime;
REVOKE ALL ON SCHEMA public FROM shopsphere_assistant_runtime;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM shopsphere_assistant_runtime', current_database());
END
$$;
DROP ROLE IF EXISTS shopsphere_assistant_runtime;
