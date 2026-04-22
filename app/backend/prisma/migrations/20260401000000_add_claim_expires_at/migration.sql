-- AlterTable
ALTER TABLE "Claim" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Claim_expiresAt_idx" ON "Claim"("expiresAt");
