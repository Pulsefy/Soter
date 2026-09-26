-- CreateEnum
CREATE TYPE "LockStatus" AS ENUM ('active', 'released', 'expired', 'force_expired');

-- CreateTable
CREATE TABLE "ReviewLock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "LockStatus" NOT NULL DEFAULT 'active',
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReviewLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewLock_entityType_entityId_status_idx" ON "ReviewLock"("entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "ReviewLock_lockedBy_idx" ON "ReviewLock"("lockedBy");

-- CreateIndex
CREATE INDEX "ReviewLock_expiresAt_idx" ON "ReviewLock"("expiresAt");

-- CreateIndex
CREATE INDEX "ReviewLock_status_expiresAt_idx" ON "ReviewLock"("status", "expiresAt");
