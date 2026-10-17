ALTER TABLE "SorobanTransaction"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "SorobanTransaction_idempotencyKey_key"
ON "SorobanTransaction"("idempotencyKey");
