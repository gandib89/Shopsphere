-- Manual rollback for #16. Run while no assistant runtime sessions are active.
-- RLS itself stays enabled on revenues/refunds/users: earlier assistant
-- migrations placed those tables under RLS and their remaining policies must
-- keep applying. Only this migration's additions are removed.
DROP POLICY IF EXISTS shopsphere_assistant_revenue_admin ON revenues;
DROP POLICY IF EXISTS shopsphere_assistant_refund_admin ON refunds;
DROP POLICY IF EXISTS shopsphere_assistant_seller_application_admin ON users;
REVOKE SELECT ("shopName", "shopDescription", "verificationRequestDate",
               "verificationApprovedDate", "verificationRejectionReason", "createdAt")
  ON TABLE users FROM shopsphere_assistant_private_runtime;
