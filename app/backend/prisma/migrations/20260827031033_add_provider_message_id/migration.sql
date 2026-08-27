-- AlterTable
ALTER TABLE "NotificationOutbox" ADD COLUMN "providerMessageId" TEXT;

-- Add comment
COMMENT ON COLUMN "NotificationOutbox"."providerMessageId" IS 'Provider-assigned message ID (e.g., SendGrid msg ID, Twilio SID)';
