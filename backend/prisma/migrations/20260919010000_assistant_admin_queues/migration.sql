-- Assistant admin support queues for #17 (PostgreSQL 16).
-- Admin queue reads are the role/operation backstop behind the application's
-- fixed membership rule (stored exception/return status strings plus failed
-- refunds inside a rolling 90-day window). Policies key on the
-- transaction-local actor GUCs only; missing context resolves to no rows.
-- Buyer email/name/delivery columns stay ungranted: the runtime role cannot
-- read what responses must never leak. Ambiguous legacy rows (NULL buyer AND
-- NULL seller attribution) are excluded by the application predicates.

-- Queue projections add the order lifecycle columns the minimized rows read:
-- human-facing order number, return/refund stage timestamps, the user-authored
-- return reason, the admin commission, and the return-image path. The image
-- path exists solely to compute the hasReturnImage boolean in the service —
-- it is never projected into a response. firstName/lastName/email/delivery*/
-- promo columns remain ungranted.
GRANT SELECT ("orderNumber", "returnRequestedAt", "returnReason", "returnImage",
              "refundReleasedAt", "adminCommission")
  ON TABLE orders TO shopsphere_assistant_private_runtime;

-- No new refunds grants: the queue reads status/amount/orderId/createdAt/id,
-- all granted by earlier assistant migrations (status reads alone would not
-- need the money column, but refundAmount is part of the reviewed contract).

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

-- Refund rows carry no admin-scoped column, so they are scoped through the
-- parent order. The orders policy above admits rows under the same support
-- operations, which is what makes this EXISTS resolvable.
DROP POLICY IF EXISTS shopsphere_assistant_refund_admin ON refunds;
CREATE POLICY shopsphere_assistant_refund_admin ON refunds
  FOR SELECT TO shopsphere_assistant_private_runtime
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = refunds."orderId"
        AND current_setting('shopsphere.actor_id', true) IS NOT NULL
        AND current_setting('shopsphere.actor_id', true) <> ''
    )
    AND current_setting('shopsphere.actor_role', true) = 'admin'
    AND current_setting('shopsphere.operation', true) IN (
      'support.orderExceptionQueue', 'support.orderExceptionDetail', 'support.returnQueue'
    )
  );
