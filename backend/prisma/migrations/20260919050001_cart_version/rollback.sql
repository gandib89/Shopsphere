-- Rollback of 20260919050001_cart_version.
REVOKE SELECT ("version") ON TABLE carts FROM shopsphere_assistant_private_runtime;
ALTER TABLE carts DROP COLUMN IF EXISTS "version";
