-- Add idpempotency key and reconciliation state to disbursement attempts

CREATE TABLE IF NOT EXISTS "disbursement_attempts" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transactionHash" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disbursement_attempts_pk" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "disbursement_attempts_idempotencyKey_key"
    ON "disbursement_attempts"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "disbursement_attempts_claimId_idx"
    ON "disbursement_attempts"("claimId");

CREATE INDEX IF NOT EXISTS "disbursement_attempts_status_idx"
    ON "disbursement_attempts"("status");
