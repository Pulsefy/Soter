-- Structured cancellation reasons for claims.
--
-- Migration note
-- --------------
-- `Claim.cancelReason` is a free-text string, so it cannot be aggregated. This
-- migration adds a `CancelReasonCode` enum alongside it; `cancelReason` is kept
-- and continues to hold the operator's free-text detail.
--
-- Existing cancelled claims are backfilled with the `unspecified` code rather
-- than left NULL, so that cancellation reporting counts every historical
-- cancellation instead of silently dropping claims that predate this migration.
-- `unspecified` means "cancelled, reason not machine-classifiable" — it is
-- never written by the cancel endpoint, which requires an explicit code.
--
-- To recover detail for backfilled rows, claims that were cancelled in order to
-- be replaced are classified as `reissued`; the rest fall back to `unspecified`
-- because the free-text reason cannot be reliably machine-parsed.
--
-- Rolling back: drop the index and column, then drop the type. The backfill is
-- not reversible, but dropping the column discards it regardless.

-- CreateEnum
CREATE TYPE "CancelReasonCode" AS ENUM ('unspecified', 'duplicate', 'recipient_ineligible', 'evidence_rejected', 'fraud_flag', 'requester_withdrew', 'budget_reallocated', 'reissued');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "cancelReasonCode" "CancelReasonCode";

-- Backfill: every already-cancelled claim gets a code so reporting covers the
-- full history.
--
-- A claim cancelled in order to be replaced is identified by a *child* row
-- pointing back at it via `reissuedFromId` — the cancelled original does not
-- carry that column itself, so the subquery below is what links the two.
UPDATE "Claim" AS target
SET "cancelReasonCode" = 'reissued'
WHERE target."status" = 'cancelled'
  AND EXISTS (
    SELECT 1 FROM "Claim" AS child WHERE child."reissuedFromId" = target."id"
  );

UPDATE "Claim"
SET "cancelReasonCode" = 'unspecified'
WHERE "status" = 'cancelled'
  AND "cancelReasonCode" IS NULL;

-- CreateIndex
CREATE INDEX "Claim_cancelReasonCode_idx" ON "Claim"("cancelReasonCode");
