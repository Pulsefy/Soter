-- Give each Soroban transaction a stable key tying one logical operation to a
-- single row. A retry after a partial failure then reuses that row instead of
-- inserting a second attempt that could submit the same disbursement twice.
--
-- Nullable on purpose: the unique index in Postgres allows any number of NULLs,
-- so operations that do not opt into a key keep inserting freely.
ALTER TABLE "SorobanTransaction" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SorobanTransaction_idempotencyKey_key" ON "SorobanTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SorobanTransaction_status_submittedAt_idx" ON "SorobanTransaction"("status", "submittedAt");
