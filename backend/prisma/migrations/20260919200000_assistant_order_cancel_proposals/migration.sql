-- Assistant order-cancellation proposals for #24 (PostgreSQL 16).
--
-- Extends the #22 proposal platform with the "proposals.orderCancel"
-- operation. No new tables: propose_order_cancellation writes the existing
-- proposals/proposal_outbox_events rows (grants from 20260919050000 cover
-- every projected column) and READS the buyer's own order plus a succeeded
-- payment for the exact-state preview.
--
-- Predicate and role semantics are unchanged from the #22/#13 policies; the
-- operation IN lists gain 'proposals.orderCancel' (the payments policy moves
-- from a single-operation equality to an IN list with the identical meaning
-- for the pre-existing operation). Execution of an accepted proposal runs as
-- the application owner through the first-party browser endpoint, exactly as
-- in #22, so no write path for the assistant runtime is added here.

-- The proposals SELECT policy gains the new operation; the subjectId = actor
-- and role = 'user' predicates are kept verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderCancel')
  );

-- The proposals INSERT policy gains the new operation; predicates verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderCancel')
  );

-- The buyer-order SELECT policy gains the new operation (the proposal preview
-- reads the owned order's status, quantity, variants, orderNumber, and
-- updatedAt); predicates verbatim.
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus', 'proposals.orderCancel')
  );

-- The buyer-payment SELECT policy gains the new operation (the preview reads
-- a succeeded payment's amount only); the orders EXISTS subquery and role
-- predicate are verbatim, the single-operation equality becomes an IN list
-- with the identical meaning for the pre-existing operation.
DROP POLICY IF EXISTS shopsphere_assistant_payment_buyer ON payments;
CREATE POLICY shopsphere_assistant_payment_buyer ON payments
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payments."orderId"
        AND orders."userId" = current_setting('shopsphere.actor_id', true)
    )
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.getMyPaymentStatus', 'proposals.orderCancel')
  );

-- Two additional order columns are projected by the cancellation preview
-- (orderNumber for the human-readable snapshot, updatedAt for the
-- optimistic-concurrency proxy). GRANT is additive; every other projected
-- order column was already granted by 20260916000000.
GRANT SELECT ("orderNumber", "updatedAt")
  ON TABLE orders TO shopsphere_assistant_private_runtime;
