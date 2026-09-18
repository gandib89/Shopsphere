-- Assistant admin platform reads for #16 (PostgreSQL 16).
-- get_platform_revenue_summary aggregates the append-only revenues ledger and
-- the refund records platform-wide under actor_role 'admin' with operation
-- 'platform.revenueSummary'; list_seller_applications reads only the
-- seller-application columns on users under actor_role 'admin' with operation
-- 'sellers.listApplications'. Missing transaction-local actor context resolves
-- to no rows.

-- Users: the application projection adds the shop display and verification
-- columns to the already-granted self columns (id, "firstName", "lastName",
-- role, "isVerified"). Email, phone, password/reset material, and home-address
-- columns stay ungranted to the assistant runtime.
GRANT SELECT ("shopName", "shopDescription", "verificationRequestDate",
              "verificationApprovedDate", "verificationRejectionReason", "createdAt")
  ON TABLE users TO shopsphere_assistant_private_runtime;

-- RLS was already enabled and forced on these tables by earlier assistant
-- migrations; the statements below are idempotent re-assertions of that state.
ALTER TABLE revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenues FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Platform ledger aggregation: row visibility widens to the whole ledger for
-- the fixed admin operation only. The ledger columns were granted for #15 and
-- cover this projection completely.
DROP POLICY IF EXISTS shopsphere_assistant_revenue_admin ON revenues;
CREATE POLICY shopsphere_assistant_revenue_admin ON revenues
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN ('platform.revenueSummary')
  );

-- Refund buckets re-use the refund columns granted for #15 (amount, status,
-- "completedAt"). The platform aggregate needs no per-order attribution, so
-- the policy admits rows directly under the admin operation without an orders
-- join; seller and buyer refund policies are untouched.
DROP POLICY IF EXISTS shopsphere_assistant_refund_admin ON refunds;
CREATE POLICY shopsphere_assistant_refund_admin ON refunds
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN ('platform.revenueSummary')
  );

-- Seller-application rows: sellers only, and only under the fixed admin
-- operation. Admin and plain user rows are never reachable through this
-- policy. Permissive policies on users still OR together, so the pre-existing
-- self policy keeps its exact behavior.
DROP POLICY IF EXISTS shopsphere_assistant_seller_application_admin ON users;
CREATE POLICY shopsphere_assistant_seller_application_admin ON users
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "role" = 'seller'
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN ('sellers.listApplications')
  );

-- FORCE RLS also applies to the table owner. Preserve the existing
-- application path explicitly (idempotent re-assertion of earlier migrations).
DO $$
DECLARE
  owner_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['revenues', 'refunds', 'users']
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
