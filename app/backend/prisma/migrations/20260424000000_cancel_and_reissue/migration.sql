-- Migration: cancel_and_reissue
-- Adds cancellation fields to Claim, a BalanceLedger for locked-balance tracking,
-- and a cancelled status to ClaimStatus.

-- SQLite does not support ALTER COLUMN or ADD CONSTRAINT after the fact,
-- so we add new nullable columns and a new table.

-- 1. Add cancellation / reissue tracking columns to Claim
ALTER TABLE "Claim" ADD COLUMN "cancelledAt"    DATETIME;
ALTER TABLE "Claim" ADD COLUMN "cancelledBy"    TEXT;
ALTER TABLE "Claim" ADD COLUMN "cancelReason"   TEXT;
ALTER TABLE "Claim" ADD COLUMN "reissuedFromId" TEXT;

-- 2. Index for fast reissue-chain lookups
CREATE INDEX "Claim_reissuedFromId_idx" ON "Claim"("reissuedFromId");

-- 3. BalanceLedger – one row per balance event on a campaign
CREATE TABLE "BalanceLedger" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "campaignId"  TEXT     NOT NULL,
    "claimId"     TEXT,
    "eventType"   TEXT     NOT NULL,   -- 'lock' | 'unlock' | 'disburse'
    "amount"      REAL     NOT NULL,
    "note"        TEXT,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceLedger_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BalanceLedger_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BalanceLedger_campaignId_idx"  ON "BalanceLedger"("campaignId");
CREATE INDEX "BalanceLedger_claimId_idx"     ON "BalanceLedger"("claimId");
CREATE INDEX "BalanceLedger_eventType_idx"   ON "BalanceLedger"("eventType");
CREATE INDEX "BalanceLedger_createdAt_idx"   ON "BalanceLedger"("createdAt");
