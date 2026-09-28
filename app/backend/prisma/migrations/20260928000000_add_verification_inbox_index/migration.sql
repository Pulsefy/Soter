-- CreateIndex
CREATE INDEX "VerificationRequest_status_createdAt_active_idx" ON "VerificationRequest"("status", "createdAt" DESC) WHERE "deletedAt" IS NULL;
