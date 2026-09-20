-- Manual rollback for #20. Run while no assistant runtime sessions are active.
-- Reverses exactly what the forward migration added: the listing_drafts table
-- and the two additive draft-copy policies on products/product_options. No
-- other table's grants or policies are touched.
DROP POLICY IF EXISTS shopsphere_assistant_product_draft ON products;
DROP POLICY IF EXISTS shopsphere_assistant_option_draft ON product_options;
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_seller ON listing_drafts;
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_insert ON listing_drafts;
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_supersede ON listing_drafts;
ALTER TABLE listing_drafts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE listing_drafts DISABLE ROW LEVEL SECURITY;
-- This migration introduced the whole grant set, so revoke every column.
REVOKE SELECT (id, "sellerId", "grantId", "sourceProductId", title, description,
               highlights, status, version, "supersedesId", "createdAt", "updatedAt")
  ON TABLE listing_drafts FROM shopsphere_assistant_private_runtime;
REVOKE INSERT (id, "sellerId", "grantId", "sourceProductId", title, description,
               highlights, status, version, "supersedesId", "createdAt", "updatedAt")
  ON TABLE listing_drafts FROM shopsphere_assistant_private_runtime;
REVOKE UPDATE (status, "updatedAt")
  ON TABLE listing_drafts FROM shopsphere_assistant_private_runtime;
DROP TABLE listing_drafts;
ALTER ROLE shopsphere_assistant_private_runtime RESET jit;
ALTER ROLE shopsphere_assistant_runtime RESET jit;
