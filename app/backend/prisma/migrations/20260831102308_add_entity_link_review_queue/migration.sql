-- CreateEnum
CREATE TYPE "EntityLinkReviewStatus" AS ENUM ('auto_accepted', 'pending_review', 'accepted', 'rejected', 'remapped');

-- AlterTable
ALTER TABLE "EntityLink" ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "reviewStatus" "EntityLinkReviewStatus" NOT NULL DEFAULT 'auto_accepted';

-- CreateIndex
CREATE INDEX "EntityLink_reviewStatus_idx" ON "EntityLink"("reviewStatus");
