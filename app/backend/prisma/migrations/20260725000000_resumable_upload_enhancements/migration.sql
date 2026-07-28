-- Resumable Upload System Enhancements
-- Expanded status model + integrity tracking + retry metadata

-- ============================================================================
-- UploadSession: add columns for persistent state, integrity, and retry
-- ============================================================================

-- Map legacy 'active' status to the new fine-grained statuses.
-- Existing sessions that are not yet complete are migrated to 'uploading'
-- so they can be resumed on startup.
UPDATE "UploadSession"
   SET "status" = CASE
       WHEN "status" = 'active' THEN 'uploading'
       ELSE "status"
   END;

ALTER TABLE "UploadSession"
    ADD COLUMN "uploadedBytes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UploadSession"
    ADD COLUMN "fileChecksum" TEXT;

ALTER TABLE "UploadSession"
    ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UploadSession"
    ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "UploadSession"
    ADD COLUMN "lastError" TEXT;

ALTER TABLE "UploadSession"
    ADD COLUMN "lastAttemptAt" DATETIME;

ALTER TABLE "UploadSession"
    ADD COLUMN "completedAt" DATETIME;

ALTER TABLE "UploadSession"
    ADD COLUMN "failedAt" DATETIME;

-- Recompute uploadedBytes for sessions that already have chunks persisted:
-- each row in UploadChunk contributes its size.
UPDATE "UploadSession"
   SET "uploadedBytes" = COALESCE(
       (SELECT SUM("size")
          FROM "UploadChunk"
         WHERE "UploadChunk"."sessionId" = "UploadSession"."id"),
       0
   );

-- Populate completedAt for historically completed sessions.
UPDATE "UploadSession"
   SET "completedAt" = "updatedAt"
 WHERE "status" = 'completed'
   AND "completedAt" IS NULL;

-- ============================================================================
-- UploadChunk: add columns for storage backend, attempts, and upload timestamp
-- ============================================================================

ALTER TABLE "UploadChunk"
    ADD COLUMN "storageBackend" TEXT NOT NULL DEFAULT 'disk';

ALTER TABLE "UploadChunk"
    ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UploadChunk"
    ADD COLUMN "lastError" TEXT;

ALTER TABLE "UploadChunk"
    ADD COLUMN "uploadedAt" DATETIME;

-- Any chunk row that exists implies it has been successfully received and
-- persisted; mark its upload time accordingly.
UPDATE "UploadChunk"
   SET "uploadedAt" = "createdAt",
       "attemptCount" = 1
 WHERE "uploadedAt" IS NULL;

-- ============================================================================
-- New indices to support startup recovery queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS "UploadSession_status_ownerId_idx"
    ON "UploadSession"("status", "ownerId");
