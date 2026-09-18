-- Assistant seller inventory proposals for #28 (operation proposals.inventoryAdjust).
--
-- No new tables: propose_inventory_adjustment writes the existing
-- proposals/proposal_outbox_events rows (column grants from 20260919050000 and
-- 20260919220000 cover every projected column) and READS the seller's own
-- product row (with its options) for the exact-state preview.
--
-- Role-predicate semantics are the ones #27 established: the proposals
-- policies pin actor_role IN ('user', 'seller') (seller-authored proposal
-- classes joined the buyer-authored ones there) and the subjectId = actor_id
-- scoping stays verbatim — it remains the isolation boundary. This migration
-- only widens the operation IN lists additively with
-- 'proposals.inventoryAdjust'. Every pre-existing operation keeps exactly its
-- old behavior because the app layer already admits only its own roles to
-- those operations.
--
-- Reads this operation needs (all predicates verbatim, one operation added):
--   - products (owned product snapshot: id, name, quantity, updatedAt version
--     proxy, and the owned options for target resolution), via the #12 seller
--     catalog policy extended;
--   - product_options (kind, value, and the stock counter the proposal
--     targets), via the #14 seller option policy extended. The option policy
--     scopes through the SAME products seller predicate, so option-level
--     proposals inherit the identical ownership boundary.
--
-- Column grants: NONE are added. Every column the preview reads was already
-- granted to shopsphere_assistant_private_runtime by earlier migrations —
-- products (id, name, quantity, "sellerId", …) by 20260916000000 and
-- products."updatedAt" by 20260919220000_product_updated_at; product_options
-- (id, "productId", kind, value, "priceDelta", stock) by 20260916000000;
-- proposals/proposal_outbox_events projections by 20260919050000 and the #26
-- outbox INSERT grant. No UPDATE/DELETE/INSERT grant beyond the existing
-- proposal-creation path is added anywhere: the assistant runtime still
-- cannot mutate products, options, or any other live surface — the one stock
-- write happens exclusively through the first-party owner execution endpoint
-- as the application owner (mirroring #22/#24/#25/#26/#27, so no write path
-- for the assistant runtime is added here either).
--
-- Note: ProductOption has no updatedAt column; the proposal's version proxy
-- is the PARENT product's products."updatedAt" (epoch seconds), which is why
-- the products policy below (and its existing "updatedAt" grant) matters for
-- option-level targets too.

-- 1. proposals SELECT: #27's policy verbatim, plus the new operation in the
--    IN list (subject + role predicates unchanged).
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange', 'proposals.inventoryAdjust')
  );

-- 2. proposals INSERT: #27's policy verbatim, plus the new operation.
--    Inventory proposals may create rows for their own subject only.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) IN ('user', 'seller')
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel', 'proposals.orderReturn', 'proposals.priceChange', 'proposals.inventoryAdjust')
  );

-- 3. products: the seller-catalog policy gains the new operation (the preview
--    reads the owned product's name, quantity, updatedAt version proxy, and
--    resolves option targets). Ownership + role predicates verbatim from
--    20260919230000_assistant_price_proposals.
DROP POLICY IF EXISTS shopsphere_assistant_product_seller ON products;
CREATE POLICY shopsphere_assistant_product_seller ON products
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "sellerId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary', 'proposals.priceChange', 'proposals.inventoryAdjust')
  );

-- 4. product_options: the #14 seller option policy gains the new operation.
--    Predicate verbatim from 20260916000000_assistant_buyer_seller_reads
--    (scoped through the same products ownership predicate; the cart branch
--    and the public branch are untouched).
DROP POLICY IF EXISTS shopsphere_assistant_option_seller ON product_options;
CREATE POLICY shopsphere_assistant_option_seller ON product_options
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = product_options."productId"
        AND products."sellerId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'seller'
    AND current_setting('shopsphere.operation', true) IN ('products.listMine', 'products.getMine', 'products.getMyInventorySummary', 'proposals.inventoryAdjust')
  );
