-- Measures the write-side cost of the two indexes added in
-- app/backend/prisma/migrations/20260926000000_add_verification_inbox_composite_index:
-- index size on disk and INSERT throughput with and without them.
--
-- Numbers recorded from this script are in docs/verification-inbox-indexes.md.
--
--   createdb soter_writecost
--   psql -d soter_writecost -f app/backend/scripts/write-amplification-verification-inbox.sql

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS "VerificationRequest";
DROP TYPE IF EXISTS "VerificationStatus";
CREATE TYPE "VerificationStatus" AS ENUM ('pending','pending_review','approved','rejected','needs_resubmission');

CREATE TABLE "VerificationRequest" (
  "id" VARCHAR(30) PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
  "orgId" VARCHAR(30)
);
CREATE INDEX "VerificationRequest_deletedAt_idx" ON "VerificationRequest"("deletedAt");
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

-- Seed 400k rows so the measured sizes are representative.
INSERT INTO "VerificationRequest" ("id","createdAt","updatedAt","deletedAt","status","orgId")
SELECT 'vr_'||lpad(g::text,24,'0'),
       TIMESTAMP '2025-01-01' + (random()*INTERVAL '600 days'),
       TIMESTAMP '2025-01-01' + (random()*INTERVAL '600 days'),
       CASE WHEN random()<0.02 THEN TIMESTAMP '2025-01-01' + (random()*INTERVAL '600 days') END,
       (ARRAY['pending','pending_review','approved','rejected','needs_resubmission']::"VerificationStatus"[])[1+floor(random()*5)],
       'org_'||lpad((1+floor(random()*500))::text,6,'0')
FROM generate_series(1,400000) g;

\echo '=== INSERT 100k rows WITH the two inbox indexes absent ==='
\timing on
INSERT INTO "VerificationRequest" ("id","createdAt","updatedAt","deletedAt","status","orgId")
SELECT 'wr_'||lpad(g::text,24,'0'),
       TIMESTAMP '2026-01-01' + (random()*INTERVAL '60 days'),
       TIMESTAMP '2026-01-01' + (random()*INTERVAL '60 days'),
       NULL,
       (ARRAY['pending','pending_review','approved','rejected','needs_resubmission']::"VerificationStatus"[])[1+floor(random()*5)],
       'org_'||lpad((1+floor(random()*500))::text,6,'0')
FROM generate_series(1,100000) g;
\timing off

-- ── Migration under test ────────────────────────────────────────────────────
CREATE INDEX "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status","createdAt" DESC);
CREATE INDEX "VerificationRequest_createdAt_idx" ON "VerificationRequest"("createdAt" DESC);
ANALYZE "VerificationRequest";

\echo '=== INSERT 100k rows WITH the two inbox indexes present ==='
\timing on
INSERT INTO "VerificationRequest" ("id","createdAt","updatedAt","deletedAt","status","orgId")
SELECT 'xr_'||lpad(g::text,24,'0'),
       TIMESTAMP '2026-01-01' + (random()*INTERVAL '60 days'),
       TIMESTAMP '2026-01-01' + (random()*INTERVAL '60 days'),
       NULL,
       (ARRAY['pending','pending_review','approved','rejected','needs_resubmission']::"VerificationStatus"[])[1+floor(random()*5)],
       'org_'||lpad((1+floor(random()*500))::text,6,'0')
FROM generate_series(1,100000) g;
\timing off

\echo '=== index sizes after 600k rows ==='
SELECT indexrelname AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE relname = 'VerificationRequest'
ORDER BY pg_relation_size(indexrelid) DESC;
