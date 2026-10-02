-- Disable draft tools before rollback. Preserves all stored draft rows.
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_grant ON listing_drafts;
