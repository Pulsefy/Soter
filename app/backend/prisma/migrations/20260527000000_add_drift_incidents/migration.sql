-- CreateTable
CREATE TABLE "DriftIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "campaignId" TEXT,
    "packageId" TEXT,
    "onchainSnapshot" JSONB NOT NULL,
    "backendSnapshot" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'unresolved',
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNotes" TEXT,
    CONSTRAINT "DriftIncident_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DriftIncident_campaignId_idx" ON "DriftIncident"("campaignId");

-- CreateIndex
CREATE INDEX "DriftIncident_kind_idx" ON "DriftIncident"("kind");

-- CreateIndex
CREATE INDEX "DriftIncident_severity_idx" ON "DriftIncident"("severity");

-- CreateIndex
CREATE INDEX "DriftIncident_resolution_idx" ON "DriftIncident"("resolution");

-- CreateIndex
CREATE INDEX "DriftIncident_createdAt_idx" ON "DriftIncident"("createdAt");

-- CreateIndex
CREATE INDEX "DriftIncident_packageId_idx" ON "DriftIncident"("packageId");
