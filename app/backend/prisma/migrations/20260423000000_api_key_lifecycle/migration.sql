-- Strengthen API key lifecycle management:
-- - allow hashing + masked previews
-- - track usage and revocation metadata
-- - keep legacy plaintext `key` nullable for backward compatibility

ALTER TABLE "ApiKey"
  ALTER COLUMN "key" DROP NOT NULL;

ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "keyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "keyPreview" TEXT,
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "revokedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "replacedById" TEXT;

-- Self-referential link for rotation chains (old -> new)
ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "ApiKey"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique index for hashed secrets (nullable; multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

CREATE INDEX IF NOT EXISTS "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");
CREATE INDEX IF NOT EXISTS "ApiKey_lastUsedAt_idx" ON "ApiKey"("lastUsedAt");
