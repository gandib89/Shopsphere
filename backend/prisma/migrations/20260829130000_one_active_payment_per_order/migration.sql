-- A fresh browser retry can carry a new Idempotency-Key. The application reuses an
-- existing initiated intent, and this partial unique index closes the concurrent race.
CREATE UNIQUE INDEX "payments_one_initiated_per_order_idx"
ON "payments"("orderId")
WHERE "status" = 'Initiated';
