-- CreateTable
CREATE TABLE "SorobanTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT,
    "operation" TEXT NOT NULL,
    "packageId" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastRetryAt" DATETIME,
    "nextRetryAt" DATETIME,
    "lastError" TEXT,
    "errorType" TEXT,
    "isRetryable" BOOLEAN NOT NULL DEFAULT true,
    "operatorAddress" TEXT,
    "recipientAddress" TEXT,
    "amount" TEXT,
    "tokenAddress" TEXT,
    "initiatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "confirmedAt" DATETIME,
    "failedAt" DATETIME,
    "expiredAt" DATETIME,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SorobanTransaction_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "entityId" TEXT,
    "entityType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SorobanTransaction_claimId_idx" ON "SorobanTransaction"("claimId");

-- CreateIndex
CREATE INDEX "SorobanTransaction_status_idx" ON "SorobanTransaction"("status");

-- CreateIndex
CREATE INDEX "SorobanTransaction_operation_idx" ON "SorobanTransaction"("operation");

-- CreateIndex
CREATE INDEX "SorobanTransaction_txHash_idx" ON "SorobanTransaction"("txHash");

-- CreateIndex
CREATE INDEX "SorobanTransaction_nextRetryAt_idx" ON "SorobanTransaction"("nextRetryAt");

-- CreateIndex
CREATE INDEX "SorobanTransaction_correlationId_idx" ON "SorobanTransaction"("correlationId");

-- CreateIndex
CREATE INDEX "SorobanTransaction_attemptCount_idx" ON "SorobanTransaction"("attemptCount");

-- CreateIndex
CREATE INDEX "SorobanTransaction_isRetryable_nextRetryAt_idx" ON "SorobanTransaction"("isRetryable", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_idx" ON "WebhookDelivery"("status");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_entityId_entityType_idx" ON "WebhookDelivery"("entityId", "entityType");
