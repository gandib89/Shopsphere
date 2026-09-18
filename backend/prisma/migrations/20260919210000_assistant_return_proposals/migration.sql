-- Buyer return proposals for #25 (operation proposals.orderReturn).
--
-- The proposal platform from #22 already isolates proposals rows by subject and
-- role; this migration only admits the new operation to the existing policies
-- (all other predicates preserved verbatim) and grants the one new orders
-- column the preview reads (the mutation marker added by migration
-- 20260919200000_order_updated_at, used as the proposal's version proxy).
--
-- Preview reads on orders: id, "orderNumber", status, "totalPrice",
-- "deliveredAt", "returnRequestedAt" were already granted by
-- 20260916000000_assistant_buyer_seller_reads and
-- 20260919010000_assistant_admin_queues. No product access is needed: the
-- return preview cites policy sources and owned-order facts only.

-- The version proxy read: proposal creation snapshots orders."updatedAt".
GRANT SELECT ("updatedAt") ON TABLE orders TO shopsphere_assistant_private_runtime;

-- proposals SELECT: admit proposals.orderReturn next to the existing proposal
-- operations. Subject + role predicates are unchanged.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_subject ON proposals;
CREATE POLICY shopsphere_assistant_proposals_subject ON proposals
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.actionStatus', 'proposals.orderReturn')
  );

-- proposals INSERT: admit proposals.orderReturn (the only operation this ticket
-- adds to the write path). Subject + role predicates are unchanged.
DROP POLICY IF EXISTS shopsphere_assistant_proposals_insert ON proposals;
CREATE POLICY shopsphere_assistant_proposals_insert ON proposals
  FOR INSERT TO shopsphere_assistant_private_runtime
  WITH CHECK (
    "subjectId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('proposals.proposeCartChange', 'proposals.orderReturn')
  );

-- Buyer orders SELECT: admit proposals.orderReturn so the preview can read the
-- caller's own order row (status, delivery and return timestamps, total, and
-- the updatedAt version proxy). Ownership + role predicates are unchanged.
DROP POLICY IF EXISTS shopsphere_assistant_order_buyer ON orders;
CREATE POLICY shopsphere_assistant_order_buyer ON orders
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    "userId" = current_setting('shopsphere.actor_id', true)
    AND current_setting('shopsphere.actor_role', true) = 'user'
    AND current_setting('shopsphere.operation', true) IN ('orders.listMine', 'orders.getMine', 'orders.trackMine', 'orders.getMyBillSummary', 'orders.getMyPaymentStatus', 'support.draftMessage', 'proposals.orderReturn')
  );
