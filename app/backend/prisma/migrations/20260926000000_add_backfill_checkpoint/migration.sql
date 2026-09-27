-- CreateEnum
CREATE TYPE "BackfillStatus" AS ENUM ('running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "BackfillCheckpoint" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "startLedger" INTEGER NOT NULL,
    "endLedger" INTEGER NOT NULL,
    "lastProcessedLedger" INTEGER NOT NULL DEFAULT 0,
    "status" "BackfillStatus" NOT NULL DEFAULT 'running',
    "campaignId" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackfillCheckpoint_jobKey_key" ON "BackfillCheckpoint"("jobKey");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_status_idx" ON "BackfillCheckpoint"("status");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_startLedger_endLedger_idx" ON "BackfillCheckpoint"("startLedger", "endLedger");

-- CreateIndex
CREATE INDEX "BackfillCheckpoint_createdAt_idx" ON "BackfillCheckpoint"("createdAt");
