-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "statusCode" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" VARCHAR(24) NOT NULL,
    "aggregateId" VARCHAR(24) NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "gatewayEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" VARCHAR(24) NOT NULL,
    "orderId" VARCHAR(24) NOT NULL,
    "orderGroupId" TEXT,
    "transactionUuid" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Initiated',
    "gatewayRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_gatewayEventId_key" ON "payment_events"("gatewayEventId");

-- CreateIndex
CREATE INDEX "payment_events_aggregateId_createdAt_idx" ON "payment_events"("aggregateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionUuid_key" ON "payments"("transactionUuid");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_orderGroupId_idx" ON "payments"("orderGroupId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
