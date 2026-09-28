-- Add a durable, retrievable storage key to evidence queue items.
-- `filePath` is now only the temporary staging path; `storageKey` holds the
-- key returned by the selected StorageDriver (local path/key or S3 object key).

-- AlterTable
ALTER TABLE "EvidenceQueueItem" ADD COLUMN "storageKey" TEXT;

-- CreateIndex
CREATE INDEX "EvidenceQueueItem_storageKey_idx" ON "EvidenceQueueItem"("storageKey");
