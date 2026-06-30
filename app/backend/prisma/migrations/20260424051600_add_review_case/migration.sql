-- Migration: add_review_case
-- Adds ReviewCase model for manual review queue tracking.

-- 1. Create ReviewCase table
CREATE TABLE "ReviewCase" (
    "id"              TEXT     NOT NULL PRIMARY KEY,
    "claimId"         TEXT     NOT NULL,
    "status"          TEXT     NOT NULL DEFAULT 'pending',
    "aiScore"         REAL     NOT NULL,
    "confidence"      REAL     NOT NULL,
    "riskLevel"       TEXT     NOT NULL,
    "factors"         TEXT,
    "recommendations" TEXT,
    "evidenceSummary" TEXT,
    "reviewerId"      TEXT,
    "reviewerNotes"   TEXT,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    "reviewedAt"      DATETIME,
    CONSTRAINT "ReviewCase_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 2. Unique index on claimId for one-to-one relation
CREATE UNIQUE INDEX "ReviewCase_claimId_key" ON "ReviewCase"("claimId");

-- 3. Indexes for query performance
CREATE INDEX "ReviewCase_status_idx"     ON "ReviewCase"("status");
CREATE INDEX "ReviewCase_riskLevel_idx"  ON "ReviewCase"("riskLevel");
CREATE INDEX "ReviewCase_createdAt_idx"  ON "ReviewCase"("createdAt");
CREATE INDEX "ReviewCase_claimId_idx"    ON "ReviewCase"("claimId");
