-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "entryHash" TEXT,
ADD COLUMN     "metadataCanonical" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "sequence" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_sequence_key" ON "AuditLog"("sequence");

