-- Backing indexes for the verification inbox review-queue query path
-- (VerificationInboxService.getInbox):
--
--   SELECT ... FROM "VerificationRequest"
--   WHERE "deletedAt" IS NULL [AND "status" = $1]
--   ORDER BY "createdAt" DESC
--   LIMIT $2 OFFSET $3
--
-- (status, "createdAt" DESC) matches the status-filtered review queue: the
-- equality predicate fixes the leading key and the index supplies the
-- descending sort order, so the scan stops after LIMIT rows instead of
-- sorting every matching claim.
--
-- ("createdAt" DESC) covers the unfiltered inbox page (no status filter),
-- which previously had to sort the whole table to return the newest page.
--
-- Note: "deletedAt" is deliberately NOT an index key. PostgreSQL does not
-- reduce the index pathkeys through a NullTest, so an index led by
-- "deletedAt" cannot be used to satisfy ORDER BY "createdAt" DESC and the
-- planner falls back to a bitmap/sequential scan plus a top-N sort. Keeping
-- "deletedAt" as a filter makes both indexes cover their query instead.

-- CreateIndex
CREATE INDEX "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VerificationRequest_createdAt_idx" ON "VerificationRequest"("createdAt" DESC);
