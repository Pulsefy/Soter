-- Enhanced Session Management Migration
-- This migration adds comprehensive session support for multi-step verification flows

-- Create enum for session types
CREATE TYPE "SessionType" AS ENUM ('otp_verification', 'claim_verification', 'multi_step_verification');

-- Create enum for session step status
CREATE TYPE "SessionStepStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'skipped');

-- Create the main Session table
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

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- Create SessionStep table for multi-step flows
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

-- Create SessionSubmission table for idempotent handling
CREATE TABLE "SessionSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionSubmission_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraints
ALTER TABLE "SessionStep" ADD CONSTRAINT "SessionStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionSubmission" ADD CONSTRAINT "SessionSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionSubmission" ADD CONSTRAINT "SessionSubmission_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SessionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create indexes for performance
CREATE INDEX "Session_type_status_idx" ON "Session"("type", "status");
CREATE INDEX "Session_contextId_idx" ON "Session"("contextId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

CREATE INDEX "SessionStep_sessionId_stepOrder_idx" ON "SessionStep"("sessionId", "stepOrder");
CREATE INDEX "SessionStep_status_idx" ON "SessionStep"("status");
CREATE INDEX "SessionStep_stepName_idx" ON "SessionStep"("stepName");

CREATE UNIQUE INDEX "SessionSubmission_submissionKey_idx" ON "SessionSubmission"("submissionKey");
CREATE INDEX "SessionSubmission_sessionId_idx" ON "SessionSubmission"("sessionId");
CREATE INDEX "SessionSubmission_stepId_idx" ON "SessionSubmission"("stepId");

-- Migrate existing VerificationSession data to new Session table
INSERT INTO "Session" ("id", "type", "status", "contextId", "metadata", "expiresAt", "createdAt", "updatedAt")
SELECT 
    "id",
    'otp_verification'::"SessionType",
    "status",
    "identifier",
    jsonb_build_object(
        'channel', "channel",
        'attempts', "attempts",
        'resendCount', "resendCount",
        'code', "code"
    ),
    "expiresAt",
    "createdAt",
    "updatedAt"
FROM "VerificationSession";

-- Create a single step for each existing verification session
INSERT INTO "SessionStep" ("id", "sessionId", "stepName", "stepOrder", "status", "attempts", "createdAt", "updatedAt")
SELECT 
    'step_' || "id",
    "id",
    'otp_validation',
    1,
    CASE 
        WHEN "status" = 'pending' THEN 'pending'::"SessionStepStatus"
        WHEN "status" = 'completed' THEN 'completed'::"SessionStepStatus"
        WHEN "status" = 'expired' THEN 'failed'::"SessionStepStatus"
        WHEN "status" = 'failed' THEN 'failed'::"SessionStepStatus"
        ELSE 'pending'::"SessionStepStatus"
    END,
    "attempts",
    "createdAt",
    "updatedAt"
FROM "VerificationSession";