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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT,
    "keyHash" TEXT,
    "keyPreview" TEXT,
    "role" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '["admin"]',
    "ngoId" TEXT,
    "orgId" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    "createdBy" TEXT,
    "revokedAt" DATETIME,
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "replacedById" TEXT,
    CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ApiKey_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ApiKey" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ApiKey" ("createdAt", "createdBy", "description", "id", "key", "keyHash", "keyPreview", "lastUsedAt", "ngoId", "orgId", "replacedById", "revokedAt", "revokedBy", "revokedReason", "role", "updatedAt") SELECT "createdAt", "createdBy", "description", "id", "key", "keyHash", "keyPreview", "lastUsedAt", "ngoId", "orgId", "replacedById", "revokedAt", "revokedBy", "revokedReason", "role", "updatedAt" FROM "ApiKey";
DROP TABLE "ApiKey";
ALTER TABLE "new_ApiKey" RENAME TO "ApiKey";
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_ngoId_idx" ON "ApiKey"("ngoId");
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");
CREATE INDEX "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");
CREATE INDEX "ApiKey_lastUsedAt_idx" ON "ApiKey"("lastUsedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
