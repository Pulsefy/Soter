-- Add ngoId to Campaign and ApiKey (issue #239: multi-NGO RBAC)
ALTER TABLE "Campaign" ADD COLUMN "ngoId" TEXT;
ALTER TABLE "ApiKey"   ADD COLUMN "ngoId" TEXT;

-- Soft-delete columns (issue #236: soft deletes)
ALTER TABLE "Campaign" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Claim"    ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Performance indexes on Claim (issue #236)
CREATE INDEX "Claim_status_idx"     ON "Claim"("status");
CREATE INDEX "Claim_campaignId_idx" ON "Claim"("campaignId");
CREATE INDEX "Claim_createdAt_idx"  ON "Claim"("createdAt");
CREATE INDEX "Claim_deletedAt_idx"  ON "Claim"("deletedAt");

-- Performance indexes on Campaign (issue #236 + #239)
CREATE INDEX "Campaign_ngoId_idx"    ON "Campaign"("ngoId");
CREATE INDEX "Campaign_deletedAt_idx" ON "Campaign"("deletedAt");

-- Index on ApiKey.ngoId (issue #239)
CREATE INDEX "ApiKey_ngoId_idx" ON "ApiKey"("ngoId");
