-- Attribute notification outbox rows to an organisation so the admin outbox
-- endpoints can be scoped per tenant. Nullable: platform-level notifications
-- (for example verification codes) and pre-existing rows have no organisation.
ALTER TABLE "NotificationOutbox" ADD COLUMN "orgId" TEXT;

-- CreateIndex
CREATE INDEX "NotificationOutbox_orgId_idx" ON "NotificationOutbox"("orgId");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
