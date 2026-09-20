-- Assistant admin recommendation drafts for #21 (PostgreSQL 16).
-- The three draft operations read exactly the same minimized admin
-- projections as the merged #16/#17/#18 read tools, so no new column grants
-- are introduced: every column this ticket reads was already granted to
-- shopsphere_assistant_private_runtime (users application columns, orders
-- queue columns, promo_codes configuration columns, promo_code_usages key
-- columns). This migration only widens the four affected per-operation
-- policies so their transaction-local operation IN lists admit the three new
-- draft operations:
--   recommendations.sellerReview    -> users (seller-application projection)
--   recommendations.returnReview    -> orders (return-queue projection)
--   recommendations.promotionReview -> promo_codes + promo_code_usages
-- Every other predicate is preserved verbatim from the migrations that created
-- these policies. Row visibility still requires actor_role 'admin' plus the
-- exact operation, and missing transaction-local context still resolves to no
-- rows.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages FORCE ROW LEVEL SECURITY;

-- Seller-application rows (#16 policy, operation list widened): sellers only,
-- and only under the fixed admin operations. Admin and plain user rows are
-- never reachable through this policy; the pre-existing self policy keeps its
-- exact behavior (permissive policies on users still OR together).
DROP POLICY IF EXISTS shopsphere_assistant_seller_application_admin ON users;
CREATE POLICY shopsphere_assistant_seller_application_admin ON users
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "role" = 'seller'
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN ('sellers.listApplications', 'recommendations.sellerReview')
  );

-- Admin queue rows (#17 policy, operation list widened). The actor-id
-- presence checks and the admin role predicate are preserved verbatim; the
-- recommendation draft adds no membership of its own — the application's fixed
-- return-queue rule stays the only membership authority.
DROP POLICY IF EXISTS shopsphere_assistant_order_admin ON orders;
CREATE POLICY shopsphere_assistant_order_admin ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_id', true) IS NOT NULL
    AND current_setting('shopsphere.actor_id', true) <> ''
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN (
      'support.orderExceptionQueue', 'support.orderExceptionDetail', 'support.returnQueue',
      'recommendations.returnReview'
    )
  );

-- Promotion configuration rows (#18 policy, operation list widened): the
-- draft resolves one promotion through the same allowlisted configuration
-- projection. createdById stays ungranted and unreadable.
DROP POLICY IF EXISTS shopsphere_assistant_promo_admin ON promo_codes;
CREATE POLICY shopsphere_assistant_promo_admin ON promo_codes
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN
      ('promotions.listConfiguration', 'promotions.usageSummary', 'recommendations.promotionReview')
  );

-- Aggregate usage rows (#18 policy, operation list widened): the draft counts
-- distinct redeemers through a groupBy of the composite key exactly as the
-- usage summary does; no per-user row is ever read back as a row.
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_admin ON promo_code_usages;
CREATE POLICY shopsphere_assistant_promo_usage_admin ON promo_code_usages
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN
      ('promotions.usageSummary', 'recommendations.promotionReview')
  );

-- FORCE RLS also applies to the table owner. Preserve the existing
-- application path explicitly (idempotent re-assertion of earlier migrations).
DO $$
DECLARE
  owner_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'orders', 'promo_codes', 'promo_code_usages']
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
