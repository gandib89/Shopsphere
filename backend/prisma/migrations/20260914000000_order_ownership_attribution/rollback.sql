-- Rollback for 20260914000000_order_ownership_attribution (PG16, manual only).
-- Prisma migrate does not auto-apply this file; run it explicitly to revert #11.
-- Dropping the attribution columns returns reads to the legacy product-join path.
-- WARNING: re-applying the forward migration leaves backfilled values NULL again
-- unless backend/scripts/backfillOrderOwnership.js is re-run.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_sellerIdAtPurchase_fkey";
DROP INDEX IF EXISTS "orders_sellerIdAtPurchase_createdAt_idx";
DROP INDEX IF EXISTS "orders_userId_createdAt_idx";
DROP INDEX IF EXISTS "products_sellerId_idx";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "sellerIdAtPurchase";
