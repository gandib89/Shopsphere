-- Assistant admin promotion reads for #18 (PostgreSQL 16).
-- Admin promotion configuration and aggregate usage counts authorize through
-- the transaction-local actor GUCs: the admin role plus exactly the two
-- promotion-read operations. The existing buyer validation policies on these
-- tables are left untouched; this migration only adds an admin surface that is
-- narrower than the full column set (createdById stays ungranted) and, for
-- promo_code_usages, covers only the two columns needed to count distinct
-- redeemers — never any content column (the table has none beyond its key).

-- Promotion configuration projection: the allowlisted rule fields plus the
-- createdAt key used for stable cursor ordering. Only "createdAt" is new for
-- this role — the buyer validation grant already covers the rule columns.
GRANT SELECT (id, code, "discountType", "discountValue", "minPurchase",
              "maxDiscount", "usageLimit", "usedCount", "validFrom",
              "validUntil", "isActive", "createdAt")
  ON TABLE promo_codes TO shopsphere_assistant_private_runtime;

-- Aggregate usage projection: distinct-redeemer counting needs the composite
-- key columns only. Re-granted here to state the exact admin projection; these
-- are the same columns the buyer self-usage grant already covers.
GRANT SELECT ("promoCodeId", "userId")
  ON TABLE promo_code_usages TO shopsphere_assistant_private_runtime;

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_usages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopsphere_assistant_promo_admin ON promo_codes;
CREATE POLICY shopsphere_assistant_promo_admin ON promo_codes
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN
      ('promotions.listConfiguration', 'promotions.usageSummary')
  );

-- Usage rows are readable only while counting redeemers for the usage
-- summary: the configuration listing operation must not touch this table, and
-- no other role or operation resolves to rows here.
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_admin ON promo_code_usages;
CREATE POLICY shopsphere_assistant_promo_usage_admin ON promo_code_usages
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) = 'promotions.usageSummary'
  );

-- FORCE RLS also applies to the table owner. Both tables already carry an
-- owner-preservation policy from the buyer-reads migration; recreate them
-- idempotently so this migration stands alone.
DO $$
DECLARE
  owner_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['promo_codes', 'promo_code_usages']
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
