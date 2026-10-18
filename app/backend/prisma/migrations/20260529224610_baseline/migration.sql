-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('requested', 'verified', 'approved', 'disbursed', 'archived', 'cancelled');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('email', 'phone');

-- CreateEnum
CREATE TYPE "VerificationSessionStatus" AS ENUM ('pending', 'completed', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('otp_verification', 'claim_verification', 'multi_step_verification');

-- CreateEnum
CREATE TYPE "SessionStepStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'pending_review', 'approved', 'rejected', 'needs_resubmission');

-- CreateEnum
CREATE TYPE "PurgeStrategy" AS ENUM ('soft_delete', 'hard_delete', 'anonymize');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('admin', 'operator', 'client', 'ngo');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('pending', 'uploading', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'enqueued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "RegistryEntityType" AS ENUM ('organization', 'location', 'asset', 'project');

-- CreateEnum
CREATE TYPE "EntityLinkSourceType" AS ENUM ('campaign', 'claim', 'verification');

-- CreateTable
CREATE TABLE "AidPackage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "campaignId" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "claimedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AidPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceLedger" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "claimId" TEXT,
    "eventType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSession" (
    "id" TEXT NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "identifier" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "status" "VerificationSessionStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "orgId" TEXT,

    CONSTRAINT "VerificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "status" "VerificationSessionStatus" NOT NULL DEFAULT 'pending',
    "contextId" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "orgId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStep" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "status" "SessionStepStatus" NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SessionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "orgId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "nextStepMessage" TEXT,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "status" "ClaimStatus" NOT NULL DEFAULT 'requested',
    "campaignId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "reissuedFromId" TEXT,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "strategy" "PurgeStrategy" NOT NULL DEFAULT 'soft_delete',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'client',
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AppRole" NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "budget" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "ngoId" TEXT,
    "orgId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "keyHash" TEXT,
    "keyPreview" TEXT,
    "role" "AppRole" NOT NULL,
    "ngoId" TEXT,
    "orgId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "replacedById" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceQueueItem" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "fileHash" TEXT NOT NULL,
    "fingerprint" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "nearDuplicateOf" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "jobId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryOrganization" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryLocation" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "country" TEXT,
    "region" TEXT,
    "coordinates" JSONB,
    "aliases" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryAsset" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "category" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryProject" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceType" "EntityLinkSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "extractedName" TEXT NOT NULL,
    "extractedType" TEXT,
    "entityType" "RegistryEntityType" NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "assetId" TEXT,
    "projectId" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "matchMethod" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AidPackage_campaignId_idx" ON "AidPackage"("campaignId");

-- CreateIndex
CREATE INDEX "AidPackage_campaignId_status_idx" ON "AidPackage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "BalanceLedger_campaignId_idx" ON "BalanceLedger"("campaignId");

-- CreateIndex
CREATE INDEX "BalanceLedger_claimId_idx" ON "BalanceLedger"("claimId");

-- CreateIndex
CREATE INDEX "BalanceLedger_eventType_idx" ON "BalanceLedger"("eventType");

-- CreateIndex
CREATE INDEX "BalanceLedger_createdAt_idx" ON "BalanceLedger"("createdAt");

-- CreateIndex
CREATE INDEX "VerificationSession_identifier_createdAt_idx" ON "VerificationSession"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationSession_status_expiresAt_idx" ON "VerificationSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "VerificationSession_deletedAt_idx" ON "VerificationSession"("deletedAt");

-- CreateIndex
CREATE INDEX "VerificationSession_orgId_idx" ON "VerificationSession"("orgId");

-- CreateIndex
CREATE INDEX "Session_type_status_idx" ON "Session"("type", "status");

-- CreateIndex
CREATE INDEX "Session_contextId_idx" ON "Session"("contextId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

-- CreateIndex
CREATE INDEX "Session_deletedAt_idx" ON "Session"("deletedAt");

-- CreateIndex
CREATE INDEX "Session_orgId_idx" ON "Session"("orgId");

-- CreateIndex
CREATE INDEX "SessionStep_sessionId_stepOrder_idx" ON "SessionStep"("sessionId", "stepOrder");

-- CreateIndex
CREATE INDEX "SessionStep_status_idx" ON "SessionStep"("status");

-- CreateIndex
CREATE INDEX "SessionStep_stepName_idx" ON "SessionStep"("stepName");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSubmission_submissionKey_key" ON "SessionSubmission"("submissionKey");

-- CreateIndex
CREATE INDEX "SessionSubmission_sessionId_idx" ON "SessionSubmission"("sessionId");

-- CreateIndex
CREATE INDEX "SessionSubmission_stepId_idx" ON "SessionSubmission"("stepId");

-- CreateIndex
CREATE INDEX "SessionSubmission_deletedAt_idx" ON "SessionSubmission"("deletedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_deletedAt_idx" ON "VerificationRequest"("deletedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_orgId_idx" ON "VerificationRequest"("orgId");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

-- CreateIndex
CREATE INDEX "VerificationRequest_reviewedAt_idx" ON "VerificationRequest"("reviewedAt");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "Claim_campaignId_idx" ON "Claim"("campaignId");

-- CreateIndex
CREATE INDEX "Claim_createdAt_idx" ON "Claim"("createdAt");

-- CreateIndex
CREATE INDEX "Claim_deletedAt_idx" ON "Claim"("deletedAt");

-- CreateIndex
CREATE INDEX "Claim_reissuedFromId_idx" ON "Claim"("reissuedFromId");

-- CreateIndex
CREATE INDEX "Claim_expiresAt_idx" ON "Claim"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_entity_key" ON "RetentionPolicy"("entity");

-- CreateIndex
CREATE INDEX "RetentionPolicy_entity_idx" ON "RetentionPolicy"("entity");

-- CreateIndex
CREATE INDEX "RetentionPolicy_enabled_idx" ON "RetentionPolicy"("enabled");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_deletedAt_idx" ON "AuditLog"("deletedAt");

-- CreateIndex
CREATE INDEX "Organization_deletedAt_idx" ON "Organization"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "Invite_status_idx" ON "Invite"("status");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_archivedAt_idx" ON "Campaign"("archivedAt");

-- CreateIndex
CREATE INDEX "Campaign_ngoId_idx" ON "Campaign"("ngoId");

-- CreateIndex
CREATE INDEX "Campaign_orgId_idx" ON "Campaign"("orgId");

-- CreateIndex
CREATE INDEX "Campaign_deletedAt_idx" ON "Campaign"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_ngoId_idx" ON "ApiKey"("ngoId");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- CreateIndex
CREATE INDEX "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");

-- CreateIndex
CREATE INDEX "ApiKey_lastUsedAt_idx" ON "ApiKey"("lastUsedAt");

-- CreateIndex
CREATE INDEX "InternalNote_entityType_entityId_idx" ON "InternalNote"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "InternalNote_authorId_idx" ON "InternalNote"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceQueueItem_fileHash_key" ON "EvidenceQueueItem"("fileHash");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_status_idx" ON "EvidenceQueueItem"("status");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_ownerId_idx" ON "EvidenceQueueItem"("ownerId");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_fileHash_idx" ON "EvidenceQueueItem"("fileHash");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_orgId_idx" ON "EvidenceQueueItem"("orgId");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_fingerprint_idx" ON "EvidenceQueueItem"("fingerprint");

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_nearDuplicateOf_idx" ON "EvidenceQueueItem"("nearDuplicateOf");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_idx" ON "NotificationOutbox"("status");

-- CreateIndex
CREATE INDEX "NotificationOutbox_recipient_idx" ON "NotificationOutbox"("recipient");

-- CreateIndex
CREATE INDEX "NotificationOutbox_scheduledFor_idx" ON "NotificationOutbox"("scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationOutbox_createdAt_idx" ON "NotificationOutbox"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_key_idx" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryOrganization_registryId_key" ON "RegistryOrganization"("registryId");

-- CreateIndex
CREATE INDEX "RegistryOrganization_registryId_idx" ON "RegistryOrganization"("registryId");

-- CreateIndex
CREATE INDEX "RegistryOrganization_name_idx" ON "RegistryOrganization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryLocation_registryId_key" ON "RegistryLocation"("registryId");

-- CreateIndex
CREATE INDEX "RegistryLocation_registryId_idx" ON "RegistryLocation"("registryId");

-- CreateIndex
CREATE INDEX "RegistryLocation_name_idx" ON "RegistryLocation"("name");

-- CreateIndex
CREATE INDEX "RegistryLocation_country_region_idx" ON "RegistryLocation"("country", "region");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryAsset_registryId_key" ON "RegistryAsset"("registryId");

-- CreateIndex
CREATE INDEX "RegistryAsset_registryId_idx" ON "RegistryAsset"("registryId");

-- CreateIndex
CREATE INDEX "RegistryAsset_name_idx" ON "RegistryAsset"("name");

-- CreateIndex
CREATE INDEX "RegistryAsset_type_idx" ON "RegistryAsset"("type");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryProject_registryId_key" ON "RegistryProject"("registryId");

-- CreateIndex
CREATE INDEX "RegistryProject_registryId_idx" ON "RegistryProject"("registryId");

-- CreateIndex
CREATE INDEX "RegistryProject_name_idx" ON "RegistryProject"("name");

-- CreateIndex
CREATE INDEX "RegistryProject_status_idx" ON "RegistryProject"("status");

-- CreateIndex
CREATE INDEX "EntityLink_sourceType_sourceId_idx" ON "EntityLink"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "EntityLink_entityType_idx" ON "EntityLink"("entityType");

-- CreateIndex
CREATE INDEX "EntityLink_organizationId_idx" ON "EntityLink"("organizationId");

-- CreateIndex
CREATE INDEX "EntityLink_locationId_idx" ON "EntityLink"("locationId");

-- CreateIndex
CREATE INDEX "EntityLink_assetId_idx" ON "EntityLink"("assetId");

-- CreateIndex
CREATE INDEX "EntityLink_projectId_idx" ON "EntityLink"("projectId");

-- CreateIndex
CREATE INDEX "EntityLink_confidenceScore_idx" ON "EntityLink"("confidenceScore");

-- CreateIndex
CREATE INDEX "EntityLink_isActive_idx" ON "EntityLink"("isActive");

-- AddForeignKey
ALTER TABLE "AidPackage" ADD CONSTRAINT "AidPackage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceLedger" ADD CONSTRAINT "BalanceLedger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceLedger" ADD CONSTRAINT "BalanceLedger_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationSession" ADD CONSTRAINT "VerificationSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStep" ADD CONSTRAINT "SessionStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSubmission" ADD CONSTRAINT "SessionSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSubmission" ADD CONSTRAINT "SessionSubmission_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SessionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceQueueItem" ADD CONSTRAINT "EvidenceQueueItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "RegistryOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RegistryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "RegistryAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RegistryProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

