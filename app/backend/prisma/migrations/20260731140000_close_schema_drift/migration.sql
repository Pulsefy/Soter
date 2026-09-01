-- CreateEnum
CREATE TYPE "SorobanTransactionStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "SorobanOperationType" AS ENUM ('create_claim', 'disburse_claim', 'init_escrow');

-- CreateEnum
CREATE TYPE "RetryableErrorType" AS ENUM ('network_timeout', 'rate_limit', 'congestion', 'temporary_failure', 'tx_too_late', 'insufficient_fee');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "SorobanEventTopic" AS ENUM ('package_created', 'package_claimed', 'package_disbursed', 'package_cancelled', 'package_expired', 'package_refunded', 'package_revoked', 'claim_created', 'claim_verified', 'claim_approved', 'claim_disbursed', 'claim_cancelled', 'claim_archived', 'escrow_initialized', 'escrow_funded', 'batch_created_event', 'extended_event', 'surplus_withdrawn_event', 'contract_paused_event', 'contract_unpaused_event', 'action_paused_event', 'action_unpaused_event', 'config_updated', 'admin_updated', 'tokens_allowed', 'tokens_removed');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "receiptPointer" TEXT;

-- CreateTable
CREATE TABLE "SorobanTransaction" (
    "id" TEXT NOT NULL,
    "claimId" TEXT,
    "operation" "SorobanOperationType" NOT NULL,
    "packageId" TEXT,
    "txHash" TEXT,
    "status" "SorobanTransactionStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastRetryAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorType" "RetryableErrorType",
    "isRetryable" BOOLEAN NOT NULL DEFAULT true,
    "operatorAddress" TEXT,
    "recipientAddress" TEXT,
    "amount" TEXT,
    "tokenAddress" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SorobanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactAccessToken" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'pending',
    "campaignId" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "reportUrl" TEXT,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SorobanEventCorrelation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eventTopic" "SorobanEventTopic" NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "claimId" TEXT,
    "packageId" TEXT,
    "aidPackageId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationSource" TEXT NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "SorobanEventCorrelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceNotificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "platform" "DevicePlatform" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceNotificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SorobanTransaction_claimId_idx" ON "SorobanTransaction"("claimId");

-- CreateIndex
CREATE INDEX "SorobanTransaction_status_idx" ON "SorobanTransaction"("status");

-- CreateIndex
CREATE INDEX "SorobanTransaction_operation_idx" ON "SorobanTransaction"("operation");

-- CreateIndex
CREATE INDEX "SorobanTransaction_txHash_idx" ON "SorobanTransaction"("txHash");

-- CreateIndex
CREATE INDEX "SorobanTransaction_nextRetryAt_idx" ON "SorobanTransaction"("nextRetryAt");

-- CreateIndex
CREATE INDEX "SorobanTransaction_correlationId_idx" ON "SorobanTransaction"("correlationId");

-- CreateIndex
CREATE INDEX "SorobanTransaction_attemptCount_idx" ON "SorobanTransaction"("attemptCount");

-- CreateIndex
CREATE INDEX "SorobanTransaction_isRetryable_nextRetryAt_idx" ON "SorobanTransaction"("isRetryable", "nextRetryAt");

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
CREATE INDEX "ImportJob_campaignId_idx" ON "ImportJob"("campaignId");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

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

-- CreateIndex
CREATE INDEX "DeviceNotificationToken_userId_idx" ON "DeviceNotificationToken"("userId");

-- CreateIndex
CREATE INDEX "DeviceNotificationToken_orgId_idx" ON "DeviceNotificationToken"("orgId");

-- CreateIndex
CREATE INDEX "DeviceNotificationToken_token_idx" ON "DeviceNotificationToken"("token");

-- CreateIndex
CREATE INDEX "DeviceNotificationToken_isActive_idx" ON "DeviceNotificationToken"("isActive");

-- CreateIndex
CREATE INDEX "DeviceNotificationToken_revokedAt_idx" ON "DeviceNotificationToken"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceNotificationToken_userId_deviceId_platform_key" ON "DeviceNotificationToken"("userId", "deviceId", "platform");

-- AddForeignKey
ALTER TABLE "SorobanTransaction" ADD CONSTRAINT "SorobanTransaction_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SorobanEventCorrelation" ADD CONSTRAINT "SorobanEventCorrelation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SorobanEventCorrelation" ADD CONSTRAINT "SorobanEventCorrelation_aidPackageId_fkey" FOREIGN KEY ("aidPackageId") REFERENCES "AidPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNotificationToken" ADD CONSTRAINT "DeviceNotificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNotificationToken" ADD CONSTRAINT "DeviceNotificationToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

