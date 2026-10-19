-- Idempotency key for the onchain disbursement path.
--
-- Migration note
-- --------------
-- `SorobanTransaction` rows are created before the onchain submission runs, so
-- a crash between submission and the local status update could previously leave
-- a claim in an ambiguous state: a retry created a *second* transaction row and
-- resubmitted, double-disbursing. `idempotencyKey` (unique) ties a logical
-- operation — e.g. `disburse:<claimId>` — to at most one transaction row, so a
-- retry after a partial failure reuses the existing row instead of creating a
-- duplicate.
--
-- The column is nullable: not all operations are keyed, and Postgres treats
-- NULLs as distinct, so existing unkeyed rows are unaffected.
--
-- Rolling back: drop the index and the column.

-- AlterTable
ALTER TABLE "SorobanTransaction" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SorobanTransaction_idempotencyKey_key" ON "SorobanTransaction"("idempotencyKey");
