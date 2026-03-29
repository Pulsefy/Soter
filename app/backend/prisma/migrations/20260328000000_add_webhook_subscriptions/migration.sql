CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_apiKeyId_idx" ON "WebhookSubscription"("apiKeyId");
CREATE INDEX "WebhookSubscription_isActive_idx" ON "WebhookSubscription"("isActive");
CREATE INDEX "WebhookDeliveryAttempt_subscriptionId_createdAt_idx" ON "WebhookDeliveryAttempt"("subscriptionId", "createdAt");
CREATE INDEX "WebhookDeliveryAttempt_event_status_idx" ON "WebhookDeliveryAttempt"("event", "status");

ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_apiKeyId_fkey"
FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
