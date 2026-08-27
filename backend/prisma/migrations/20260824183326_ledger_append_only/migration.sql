-- Enforce append-only at the DB role level: the app's DB role can INSERT and SELECT payment
-- events but cannot UPDATE or DELETE them, so a bug (or a compromised app process) can't rewrite
-- the audit trail. Adjust the role name below if your DATABASE_URL user differs from "shopsphere".
REVOKE UPDATE, DELETE ON payment_events FROM shopsphere;
