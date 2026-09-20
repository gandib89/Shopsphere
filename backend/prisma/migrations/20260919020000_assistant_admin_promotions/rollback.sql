-- Manual rollback for #18. Run while no assistant runtime sessions are active.
-- Only the admin surface introduced by this migration is removed. Row-level
-- security stays ENABLED and FORCED on both tables and the buyer validation
-- policies keep their grants — the rollback must not weaken the pre-existing
-- buyer surface.

DROP POLICY IF EXISTS shopsphere_assistant_promo_admin ON promo_codes;
DROP POLICY IF EXISTS shopsphere_assistant_promo_usage_admin ON promo_code_usages;

-- promo_codes: only the createdAt column was newly granted to the restricted
-- runtime by this migration; the buyer validation grant owns the rest and
-- keeps it.
REVOKE SELECT ("createdAt")
  ON TABLE promo_codes FROM shopsphere_assistant_private_runtime;

-- promo_code_usages: this migration's grant restates columns the buyer
-- self-usage grant already covers, so nothing is revoked here.
