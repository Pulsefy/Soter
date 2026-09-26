-- CreateEnum
CREATE TYPE "SearchIndexEntityType" AS ENUM ('campaign', 'claim', 'recipient', 'verification');

-- CreateEnum
CREATE TYPE "SearchIndexBuildStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "SearchIndexEntry" (
    "id" TEXT NOT NULL,
    "entityType" "SearchIndexEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchIndexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchIndexBuild" (
    "id" TEXT NOT NULL,
    "status" "SearchIndexBuildStatus" NOT NULL DEFAULT 'running',
    "mode" TEXT NOT NULL DEFAULT 'rebuild',
    "entityTypes" JSONB NOT NULL,
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "triggeredBy" TEXT,
    "totalDocuments" INTEGER NOT NULL DEFAULT 0,
    "processedDocuments" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "statistics" JSONB,
    "error" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchIndexBuild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchIndexEntry_orgId_entityType_idx" ON "SearchIndexEntry"("orgId", "entityType");

-- CreateIndex
CREATE INDEX "SearchIndexEntry_buildId_idx" ON "SearchIndexEntry"("buildId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchIndexEntry_entityType_entityId_orgId_key" ON "SearchIndexEntry"("entityType", "entityId", "orgId");

-- CreateIndex
CREATE INDEX "SearchIndexBuild_status_idx" ON "SearchIndexBuild"("status");

-- CreateIndex
CREATE INDEX "SearchIndexBuild_createdAt_idx" ON "SearchIndexBuild"("createdAt");