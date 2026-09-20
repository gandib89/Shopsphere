-- Rollback of 20260919195959_order_updated_at (run while no assistant runtime
-- sessions are active). Drops the mutation marker added for #25; proposal rows
-- that captured it as expectedVersion become unexecutable and must be resolved
-- (expired) before rolling back.
ALTER TABLE orders DROP COLUMN IF EXISTS "updatedAt";
