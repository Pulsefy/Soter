-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "graceExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ApiKey_graceExpiresAt_idx" ON "ApiKey"("graceExpiresAt");
