-- CreateTable
CREATE TABLE "ArtifactAccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SorobanEventCorrelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "eventTopic" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "claimId" TEXT,
    "packageId" TEXT,
    "aidPackageId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationSource" TEXT NOT NULL DEFAULT 'scheduled',
    CONSTRAINT "SorobanEventCorrelation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SorobanEventCorrelation_aidPackageId_fkey" FOREIGN KEY ("aidPackageId") REFERENCES "AidPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UploadSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "totalSize" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "uploadedBytes" INTEGER NOT NULL DEFAULT 0,
    "fileChecksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lastAttemptAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "metadata" JSONB
);
INSERT INTO "new_UploadSession" ("chunkSize", "completedAt", "createdAt", "expiresAt", "failedAt", "fileChecksum", "fileName", "id", "lastAttemptAt", "lastError", "maxAttempts", "mimeType", "orgId", "ownerId", "retryCount", "status", "totalChunks", "totalSize", "updatedAt", "uploadedBytes") SELECT "chunkSize", "completedAt", "createdAt", "expiresAt", "failedAt", "fileChecksum", "fileName", "id", "lastAttemptAt", "lastError", "maxAttempts", "mimeType", "orgId", "ownerId", "retryCount", "status", "totalChunks", "totalSize", "updatedAt", "uploadedBytes" FROM "UploadSession";
DROP TABLE "UploadSession";
ALTER TABLE "new_UploadSession" RENAME TO "UploadSession";
CREATE INDEX "UploadSession_ownerId_idx" ON "UploadSession"("ownerId");
CREATE INDEX "UploadSession_status_idx" ON "UploadSession"("status");
CREATE INDEX "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");
CREATE INDEX "UploadSession_status_ownerId_idx" ON "UploadSession"("status", "ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactAccessToken_tokenHash_key" ON "ArtifactAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ArtifactAccessToken_artifactId_idx" ON "ArtifactAccessToken"("artifactId");

-- CreateIndex
CREATE INDEX "ArtifactAccessToken_orgId_idx" ON "ArtifactAccessToken"("orgId");

-- CreateIndex
CREATE INDEX "ArtifactAccessToken_tokenHash_idx" ON "ArtifactAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ArtifactAccessToken_expiresAt_idx" ON "ArtifactAccessToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ArtifactAccessToken_revokedAt_idx" ON "ArtifactAccessToken"("revokedAt");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_claimId_idx" ON "SorobanEventCorrelation"("claimId");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_packageId_idx" ON "SorobanEventCorrelation"("packageId");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_aidPackageId_idx" ON "SorobanEventCorrelation"("aidPackageId");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_txHash_idx" ON "SorobanEventCorrelation"("txHash");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_ledger_idx" ON "SorobanEventCorrelation"("ledger");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_eventTopic_idx" ON "SorobanEventCorrelation"("eventTopic");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_createdAt_idx" ON "SorobanEventCorrelation"("createdAt");

-- CreateIndex
CREATE INDEX "SorobanEventCorrelation_correlationSource_idx" ON "SorobanEventCorrelation"("correlationSource");

-- CreateIndex
CREATE UNIQUE INDEX "SorobanEventCorrelation_txHash_eventIndex_key" ON "SorobanEventCorrelation"("txHash", "eventIndex");
