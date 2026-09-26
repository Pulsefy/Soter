-- Reproduce the verification inbox query path against a synthetic dataset so
-- the composite indexes added in
-- app/backend/prisma/migrations/20260926000000_add_verification_inbox_composite_index
-- can be measured with EXPLAIN (ANALYZE, BUFFERS) before and after they exist.
--
-- Usage (scratch database only, never production):
--   createdb soter_explain
--   psql -d soter_explain -f app/backend/scripts/explain-verification-inbox.sql
--
-- The table mirrors the columns the inbox query touches on VerificationRequest.
-- The 400k rows and the 2% soft-delete ratio are chosen so the effect of the
-- index is visible; they are not production numbers.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS "VerificationRequest";

DROP TYPE IF EXISTS "VerificationStatus";
CREATE TYPE "VerificationStatus" AS ENUM (
  'pending',
  'pending_review',
  'approved',
  'rejected',
  'needs_resubmission'
);

CREATE TABLE "VerificationRequest" (
  "id" VARCHAR(30) PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
  "orgId" VARCHAR(30)
);

-- Pre-existing single-column indexes from the baseline migration.
CREATE INDEX "VerificationRequest_deletedAt_idx" ON "VerificationRequest"("deletedAt");
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

INSERT INTO "VerificationRequest" ("id", "createdAt", "updatedAt", "deletedAt", "status", "orgId")
SELECT
  'vr_' || lpad(g::text, 24, '0'),
  TIMESTAMP '2025-01-01' + (random() * INTERVAL '600 days'),
  TIMESTAMP '2025-01-01' + (random() * INTERVAL '600 days'),
  CASE WHEN random() < 0.02
       THEN TIMESTAMP '2025-01-01' + (random() * INTERVAL '600 days')
       ELSE NULL END,
  (ARRAY['pending','pending_review','approved','rejected','needs_resubmission']::"VerificationStatus"[])[1 + floor(random() * 5)],
  'org_' || lpad((1 + floor(random() * 500))::text, 6, '0')
FROM generate_series(1, 400000) AS g;

ANALYZE "VerificationRequest";

\echo '=== BEFORE: status-filtered inbox page (review queue default) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL AND "status" = 'pending_review'
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;

\echo '=== BEFORE: unfiltered inbox page ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;

-- ── Migration under test ────────────────────────────────────────────────────
CREATE INDEX "VerificationRequest_status_createdAt_idx"
  ON "VerificationRequest"("status", "createdAt" DESC);
CREATE INDEX "VerificationRequest_createdAt_idx"
  ON "VerificationRequest"("createdAt" DESC);

ANALYZE "VerificationRequest";

\echo '=== AFTER: status-filtered inbox page (review queue default) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL AND "status" = 'pending_review'
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;

\echo '=== AFTER: unfiltered inbox page ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;
