-- Migration: add_notification_outbox
-- Adds the NotificationOutbox table and NotificationOutboxStatus enum (stored as TEXT in SQLite)
-- following the same outbox pattern as EvidenceQueueItem.

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "type"          TEXT     NOT NULL,
    "recipient"     TEXT     NOT NULL,
    "subject"       TEXT,
    "message"       TEXT     NOT NULL,
    "status"        TEXT     NOT NULL DEFAULT 'pending',
    "retryCount"    INTEGER  NOT NULL DEFAULT 0,
    "lastError"     TEXT,
    "lastAttemptAt" DATETIME,
    "scheduledFor"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"        DATETIME,
    "jobId"         TEXT,
    "metadata"      TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_idx"       ON "NotificationOutbox"("status");
CREATE INDEX "NotificationOutbox_recipient_idx"    ON "NotificationOutbox"("recipient");
CREATE INDEX "NotificationOutbox_scheduledFor_idx" ON "NotificationOutbox"("scheduledFor");
CREATE INDEX "NotificationOutbox_createdAt_idx"    ON "NotificationOutbox"("createdAt");
