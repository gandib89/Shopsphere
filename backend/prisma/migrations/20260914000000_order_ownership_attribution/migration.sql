-- Immutable order ownership attribution (#11).
-- Additive and nullable so existing storefront behavior stays green on PG16.
-- New columns are written by order creation from here on; legacy rows are
-- backfilled by backend/scripts/backfillOrderOwnership.js (trustworthy rows only).
-- Ambiguous rows keep sellerIdAtPurchase NULL and stay quarantined from assistant reads.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "sellerIdAtPurchase" VARCHAR(24);

-- Backfill-safe FK: a deleted seller NULLs the attribution (row becomes quarantined)
-- instead of blocking the delete or fabricating a new owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_sellerIdAtPurchase_fkey') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerIdAtPurchase_fkey"
      FOREIGN KEY ("sellerIdAtPurchase") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_sellerIdAtPurchase_createdAt_idx" ON "orders"("sellerIdAtPurchase", "createdAt");
CREATE INDEX IF NOT EXISTS "products_sellerId_idx" ON "products"("sellerId");
