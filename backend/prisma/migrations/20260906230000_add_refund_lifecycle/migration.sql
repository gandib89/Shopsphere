CREATE TABLE "refunds" (
    "id" VARCHAR(24) NOT NULL,
    "paymentId" VARCHAR(24) NOT NULL,
    "orderId" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Processing',
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "providerRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refunds_paymentId_key" ON "refunds"("paymentId");
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");
CREATE INDEX "refunds_orderId_createdAt_idx" ON "refunds"("orderId", "createdAt");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
