CREATE TABLE "UploadSession" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "ownerId"     TEXT NOT NULL,
  "orgId"       TEXT,
  "fileName"    TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "totalSize"   INTEGER NOT NULL,
  "chunkSize"   INTEGER NOT NULL,
  "totalChunks" INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'active',
  "expiresAt"   DATETIME NOT NULL,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL
);

CREATE TABLE "UploadChunk" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "index"     INTEGER NOT NULL,
  "size"      INTEGER NOT NULL,
  "checksum"  TEXT NOT NULL,
  "filePath"  TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UploadSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UploadChunk_sessionId_index_key" ON "UploadChunk"("sessionId", "index");
CREATE INDEX "UploadSession_ownerId_idx"  ON "UploadSession"("ownerId");
CREATE INDEX "UploadSession_status_idx"   ON "UploadSession"("status");
CREATE INDEX "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");
CREATE INDEX "UploadChunk_sessionId_idx"  ON "UploadChunk"("sessionId");
