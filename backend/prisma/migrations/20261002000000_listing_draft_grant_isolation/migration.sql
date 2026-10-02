-- Grant isolation is enforced by PostgreSQL as well as application predicates.
-- RESTRICTIVE combines with every existing permissive operation/owner policy.
CREATE POLICY shopsphere_assistant_listing_draft_grant ON listing_drafts
  AS RESTRICTIVE FOR ALL TO shopsphere_assistant_private_runtime
  USING ("grantId" = NULLIF(current_setting('shopsphere.grant_id', true), ''))
  WITH CHECK ("grantId" = NULLIF(current_setting('shopsphere.grant_id', true), ''));
