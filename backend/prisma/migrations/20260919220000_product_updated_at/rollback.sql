-- Rollback of 20260919220000_product_updated_at (run while no assistant runtime
-- sessions are active). Drops the mutation marker added for #27; proposal rows
-- that captured it as expectedVersion become unexecutable and must be resolved
-- (expired) before rolling back.
ALTER TABLE products DROP COLUMN IF EXISTS "updatedAt";
