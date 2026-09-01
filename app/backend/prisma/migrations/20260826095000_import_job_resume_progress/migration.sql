ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "Claim"
  ADD COLUMN "importJobId" TEXT,
  ADD COLUMN "importRowNumber" INTEGER;

ALTER TABLE "ImportJob"
  ADD COLUMN "checkpointRow" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "filePath" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "Claim_importJobId_idx" ON "Claim"("importJobId");
CREATE UNIQUE INDEX "Claim_importJobId_importRowNumber_key" ON "Claim"("importJobId", "importRowNumber");
CREATE INDEX "ImportJob_checkpointRow_idx" ON "ImportJob"("checkpointRow");
