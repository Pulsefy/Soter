-- Composite index for the verification inbox query path
-- (VerificationInboxService.getInbox):
--   WHERE "deletedAt" IS NULL AND "status" = $1 ORDER BY "createdAt" DESC LIMIT n OFFSET m
-- Equality columns come first, the sort column last, so Postgres can walk the
-- index in order and stop after LIMIT rows instead of scanning and sorting.
--
-- Write-amplification tradeoff: every INSERT of a VerificationRequest, and every
-- UPDATE that changes "status" or "deletedAt" (i.e. each review decision or
-- soft delete), now maintains one more B-tree entry, and "status" changes defeat
-- HOT updates. The table is small-row and review-rate (human) bound, so the extra
-- write cost is negligible compared to the read savings on the inbox. The
-- existing single-column "status" index is a prefix of this one and could be
-- dropped later to offset the cost once its other users are confirmed.
--
-- Verify with EXPLAIN (ANALYZE, BUFFERS) before/after; see
-- docs/verification-inbox-index.md.

-- CreateIndex
CREATE INDEX "VerificationRequest_status_deletedAt_createdAt_idx" ON "VerificationRequest"("status", "deletedAt", "createdAt" DESC);
