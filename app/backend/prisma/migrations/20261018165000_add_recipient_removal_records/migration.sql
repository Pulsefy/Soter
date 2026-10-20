-- Recipient removals are stored separately from claims and general audit logs.
CREATE TYPE "RecipientRemovalReasonCode" AS ENUM (
  'duplicate',
  'deceased',
  'relocated',
  'ineligible',
  'consent_withdrawn',
  'fraud_flag',
  'data_correction',
  'other'
);

CREATE TABLE "RecipientRemoval" (
  "id" TEXT NOT NULL,
  "recipientRef" TEXT NOT NULL,
  "ngoId" TEXT,
  "reasonCode" "RecipientRemovalReasonCode" NOT NULL,
  "reason" TEXT,
  "removedBy" TEXT NOT NULL,
  "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecipientRemoval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecipientRemoval_recipientRef_removedAt_idx"
  ON "RecipientRemoval"("recipientRef", "removedAt");
CREATE INDEX "RecipientRemoval_ngoId_removedAt_idx"
  ON "RecipientRemoval"("ngoId", "removedAt");
CREATE INDEX "RecipientRemoval_removedAt_idx"
  ON "RecipientRemoval"("removedAt");
CREATE INDEX "RecipientRemoval_reasonCode_idx"
  ON "RecipientRemoval"("reasonCode");
