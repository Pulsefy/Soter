-- CreateTable
CREATE TABLE "OnChainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "packageId" TEXT,
    "claimId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "correlatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CorrelationCursor" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "lastLedger" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OnChainEvent_txHash_topic_key" ON "OnChainEvent"("txHash", "topic");

-- CreateIndex
CREATE INDEX "OnChainEvent_packageId_idx" ON "OnChainEvent"("packageId");

-- CreateIndex
CREATE INDEX "OnChainEvent_claimId_idx" ON "OnChainEvent"("claimId");

-- CreateIndex
CREATE INDEX "OnChainEvent_ledger_idx" ON "OnChainEvent"("ledger");

-- CreateIndex
CREATE INDEX "OnChainEvent_correlatedAt_idx" ON "OnChainEvent"("correlatedAt");
