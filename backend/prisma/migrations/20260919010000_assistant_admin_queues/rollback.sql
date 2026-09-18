-- Manual rollback for #17. Run while no assistant runtime sessions are active.
DROP POLICY IF EXISTS shopsphere_assistant_order_admin ON orders;
DROP POLICY IF EXISTS shopsphere_assistant_refund_admin ON refunds;
-- Only this migration's columns are revoked; every earlier assistant grant on
-- orders (buyer/seller projections) and refunds stays untouched.
REVOKE SELECT ("orderNumber", "returnRequestedAt", "returnReason", "returnImage",
               "refundReleasedAt", "adminCommission")
  ON TABLE orders FROM shopsphere_assistant_private_runtime;
