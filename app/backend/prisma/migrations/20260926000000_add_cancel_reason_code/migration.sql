-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "cancelReasonCode" TEXT;

-- Backfill existing cancelled claims so they have a reporting bucket instead
-- of remaining null. New cancellations always carry an explicit code.
UPDATE "Claim"
SET "cancelReasonCode" = 'unspecified'
WHERE "status" = 'cancelled' AND "cancelReasonCode" IS NULL;

-- CreateIndex
CREATE INDEX "Claim_cancelReasonCode_idx" ON "Claim"("cancelReasonCode");
