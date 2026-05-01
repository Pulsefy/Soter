ALTER TABLE "Claim"
ADD COLUMN "expiresAt" DATETIME;

CREATE INDEX "Claim_expiresAt_idx" ON "Claim"("expiresAt");
