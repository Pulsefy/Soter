-- CreateEnum
CREATE TYPE "DeliveryAttemptOutcome" AS ENUM ('success', 'failed');

-- CreateTable
CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" "DeliveryAttemptOutcome" NOT NULL,
    "failureCategory" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDeliveryAttempt_outboxId_idx" ON "NotificationDeliveryAttempt"("outboxId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryAttempt_outcome_idx" ON "NotificationDeliveryAttempt"("outcome");

-- CreateIndex
CREATE INDEX "NotificationDeliveryAttempt_failureCategory_idx" ON "NotificationDeliveryAttempt"("failureCategory");

-- CreateIndex
CREATE INDEX "NotificationDeliveryAttempt_startedAt_idx" ON "NotificationDeliveryAttempt"("startedAt");

-- AddForeignKey
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
