-- Seller-owned unpublished listing drafts for #20 (PostgreSQL 16).
-- listing_drafts is a standalone, versioned, never-published record: saving
-- creates or versions only an owned draft row and can never touch the live
-- products table. grantId scopes every row to the delegated grant (Keycloak
-- sid) that created it, so reads, writes, versions, and cursors are isolated
-- by subject AND grant. Unverified sellers keep drafting: the policies key on
-- role 'seller' only — no isVerified condition exists anywhere.
-- There is no DELETE grant and no DELETE policy: drafts are never deleted
-- through the assistant runtime.

CREATE TABLE listing_drafts (
  id varchar(24) PRIMARY KEY,
  "sellerId" varchar(24) NOT NULL,
  "grantId" varchar(200) NOT NULL,
  "sourceProductId" varchar(24),
  title varchar(140) NOT NULL,
  description varchar(4000) NOT NULL,
  highlights jsonb,
  status varchar(20) NOT NULL DEFAULT 'Draft',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  "supersedesId" varchar(24),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX listing_drafts_seller_grant_time_idx
  ON listing_drafts ("sellerId", "grantId", "createdAt");

-- 1. Column-scoped grants (only what the tools read/write). UPDATE is limited
-- to the supersede transition columns: title/description/highlights have no
-- UPDATE grant, so a saved version can never rewrite an existing row's content.
GRANT SELECT (id, "sellerId", "grantId", "sourceProductId", title, description,
              highlights, status, version, "supersedesId", "createdAt", "updatedAt")
  ON TABLE listing_drafts TO shopsphere_assistant_private_runtime;
GRANT INSERT (id, "sellerId", "grantId", "sourceProductId", title, description,
              highlights, status, version, "supersedesId", "createdAt", "updatedAt")
  ON TABLE listing_drafts TO shopsphere_assistant_private_runtime;
GRANT UPDATE (status, "updatedAt")
  ON TABLE listing_drafts TO shopsphere_assistant_private_runtime;

-- 2. Enable + force RLS (FORCE applies RLS to the table owner too).
ALTER TABLE listing_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_drafts FORCE ROW LEVEL SECURITY;

-- 3. Per-operation policies on transaction-local GUC context. grantId is
-- checked by the application predicates; RLS keys on the subject/role/operation
-- GUCs as the outer boundary (the GUC actor is the subject, shared across the
-- seller's grants, exactly like every other assistant table).
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_seller ON listing_drafts;
CREATE POLICY shopsphere_assistant_listing_draft_seller ON listing_drafts
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN (
      'listings.draftCopy', 'listings.saveDraft', 'listings.listDrafts', 'listings.getDraft'
    )
  );

DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_insert ON listing_drafts;
CREATE POLICY shopsphere_assistant_listing_draft_insert ON listing_drafts
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) = 'listings.saveDraft'
  );

-- Supersede-only mutation: a draft row may flip to 'Superseded' during a
-- versioning save, and only for its own subject. Content columns are not even
-- updatable (no column grant), and reverting 'Superseded' -> 'Draft' fails the
-- WITH CHECK.
DROP POLICY IF EXISTS shopsphere_assistant_listing_draft_supersede ON listing_drafts;
CREATE POLICY shopsphere_assistant_listing_draft_supersede ON listing_drafts
  FOR UPDATE TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) = 'listings.saveDraft'
  )
  WITH CHECK (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND status = 'Superseded'
  );

-- Draft copy and draft provenance read one owned product's public-safe fields
-- (name, category, description, option kinds/values): draftListingCopy for
-- composition, saveListingDraft to verify a supplied sourceProductId is owned
-- before storing it. These policies are additive to the seller catalog
-- policies: they admit only the two listings operations and only the seller's
-- own rows — the service never selects quantity/stock.
DROP POLICY IF EXISTS shopsphere_assistant_product_draft ON products;
CREATE POLICY shopsphere_assistant_product_draft ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('listings.draftCopy', 'listings.saveDraft')
  );
DROP POLICY IF EXISTS shopsphere_assistant_option_draft ON product_options;
CREATE POLICY shopsphere_assistant_option_draft ON product_options
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = product_options."productId"
        AND products."sellerId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) = 'listings.draftCopy'
  );

-- 4. Owner-preservation because of FORCE RLS (dynamic owner lookup).
DO $$
DECLARE
  owner_name text;
BEGIN
  SELECT tableowner INTO owner_name
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'listing_drafts';
  DROP POLICY IF EXISTS shopsphere_application_owner ON listing_drafts;
  EXECUTE format(
    'CREATE POLICY shopsphere_application_owner ON listing_drafts TO %I USING (true) WITH CHECK (true)',
    owner_name
  );
END
$$;

-- Every policy added by this ticket (and the ones before it) widens the
-- planner's work: the restricted roles run short, latency-budgeted statements
-- (statement_timeout is set per transaction by withAssistantActor), and JIT
-- compilation of the many OR'd RLS policies can consume that entire budget on
-- its own. Turn JIT off for the assistant runtimes so plan time stays
-- predictable; this changes no security property.
ALTER ROLE shopsphere_assistant_private_runtime SET jit = off;
ALTER ROLE shopsphere_assistant_runtime SET jit = off;
