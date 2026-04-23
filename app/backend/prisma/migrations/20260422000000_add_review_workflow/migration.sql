-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "verificationScore" DOUBLE PRECISION,
ADD COLUMN     "verificationResult" JSONB,
ADD COLUMN     "reviewStatus" "ReviewStatus",
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewSlaStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Claim_reviewStatus_idx" ON "Claim"("reviewStatus");

-- CreateIndex
CREATE INDEX "Claim_reviewSlaStartedAt_idx" ON "Claim"("reviewSlaStartedAt");
