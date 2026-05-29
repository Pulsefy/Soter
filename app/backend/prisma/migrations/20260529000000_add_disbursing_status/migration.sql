-- For SQLite, enum changes require recreating the table
-- This migration adds the 'disbursing' status to ClaimStatus enum

CREATE TABLE "Claim_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "campaignId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "expiresAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "reissuedFromId" TEXT,
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("reissuedFromId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Claim_new" ("id", "createdAt", "updatedAt", "deletedAt", "status", "campaignId", "amount", "recipientRef", "evidenceRef", "expiresAt", "cancelledAt", "cancelledBy", "cancelReason", "reissuedFromId")
SELECT "id", "createdAt", "updatedAt", "deletedAt", "status", "campaignId", "amount", "recipientRef", "evidenceRef", "expiresAt", "cancelledAt", "cancelledBy", "cancelReason", "reissuedFromId"
FROM "Claim";

DROP TABLE "Claim";

ALTER TABLE "Claim_new" RENAME TO "Claim";

CREATE INDEX "Claim_status_idx" ON "Claim"("status");
CREATE INDEX "Claim_campaignId_idx" ON "Claim"("campaignId");
CREATE INDEX "Claim_createdAt_idx" ON "Claim"("createdAt");
CREATE INDEX "Claim_deletedAt_idx" ON "Claim"("deletedAt");
CREATE INDEX "Claim_reissuedFromId_idx" ON "Claim"("reissuedFromId");
CREATE INDEX "Claim_expiresAt_idx" ON "Claim"("expiresAt");
