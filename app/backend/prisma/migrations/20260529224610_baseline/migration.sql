-- CreateTable
CREATE TABLE "AidPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "campaignId" TEXT,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "claimedAmount" REAL NOT NULL DEFAULT 0,
    "remainingAmount" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "AidPackage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BalanceLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "claimId" TEXT,
    "eventType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceLedger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BalanceLedger_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "orgId" TEXT,
    CONSTRAINT "VerificationSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contextId" TEXT,
    "metadata" JSONB,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "deletedAt" DATETIME,
    "orgId" TEXT,
    CONSTRAINT "Session_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "SessionSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionSubmission_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SessionStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "orgId" TEXT,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "nextStepMessage" TEXT,
    CONSTRAINT "VerificationRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "campaignId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "expiresAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "reissuedFromId" TEXT,
    CONSTRAINT "Claim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Claim_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'soft_delete',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'client',
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "budget" REAL NOT NULL,
    "metadata" JSONB,
    "ngoId" TEXT,
    "orgId" TEXT,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT,
    "keyHash" TEXT,
    "keyPreview" TEXT,
    "role" TEXT NOT NULL,
    "ngoId" TEXT,
    "orgId" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    "createdBy" TEXT,
    "revokedAt" DATETIME,
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "replacedById" TEXT,
    CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ApiKey_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ApiKey" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EvidenceQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "fileHash" TEXT NOT NULL,
    "fingerprint" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "nearDuplicateOf" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceQueueItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" DATETIME,
    "scheduledFor" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "jobId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RegistryOrganization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistryLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "country" TEXT,
    "region" TEXT,
    "coordinates" JSONB,
    "aliases" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistryAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "category" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistryProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "extractedName" TEXT NOT NULL,
    "extractedType" TEXT,
    "entityType" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "assetId" TEXT,
    "projectId" TEXT,
    "confidenceScore" REAL NOT NULL,
    "matchMethod" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "reviewNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    CONSTRAINT "EntityLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "RegistryOrganization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EntityLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RegistryLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EntityLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "RegistryAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EntityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RegistryProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
