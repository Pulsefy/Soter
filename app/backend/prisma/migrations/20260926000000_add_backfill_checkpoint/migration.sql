-- CreateTable
CREATE TABLE "BackfillCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobKey" TEXT NOT NULL,
    "startLedger" INTEGER NOT NULL,
    "endLedger" INTEGER NOT NULL,
    "lastProcessedLedger" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "BackfillCheckpoint_jobKey_key" ON "BackfillCheckpoint"("jobKey");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_status_idx" ON "BackfillCheckpoint"("status");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_campaignId_idx" ON "BackfillCheckpoint"("campaignId");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_startLedger_endLedger_idx" ON "BackfillCheckpoint"("startLedger", "endLedger");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_createdAt_idx" ON "BackfillCheckpoint"("createdAt");
