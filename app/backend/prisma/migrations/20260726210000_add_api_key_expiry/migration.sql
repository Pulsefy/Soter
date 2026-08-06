-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");
