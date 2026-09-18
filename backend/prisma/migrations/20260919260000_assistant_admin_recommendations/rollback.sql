-- Manual rollback for #21. Run while no assistant runtime sessions are active.
-- This migration introduced no column grants, so nothing is revoked. The four
-- widened policies are restored to the exact operation lists and predicates
-- they carried before this migration (#16 users policy, #17 orders policy,
-- #18 promo policies); row-level security stays ENABLED and FORCED on all
-- four tables.

DROP POLICY IF EXISTS shopsphere_assistant_seller_application_admin ON users;
CREATE POLICY shopsphere_assistant_seller_application_admin ON users
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "role" = 'seller'
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN ('sellers.listApplications')
  );

DROP POLICY IF EXISTS shopsphere_assistant_order_admin ON orders;
CREATE POLICY shopsphere_assistant_order_admin ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_id', true) IS NOT NULL
    AND current_setting('shopsphere.actor_id', true) <> ''
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN (
      'support.orderExceptionQueue', 'support.orderExceptionDetail', 'support.returnQueue'
    )
  );

DROP POLICY IF EXISTS shopsphere_assistant_promo_admin ON promo_codes;
CREATE POLICY shopsphere_assistant_promo_admin ON promo_codes
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN
      ('promotions.listConfiguration', 'promotions.usageSummary')
  );

DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_admin ON promo_code_usages;
CREATE POLICY shopsphere_assistant_promo_usage_admin ON promo_code_usages
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) = 'promotions.usageSummary'
  );
