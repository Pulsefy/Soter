-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "scopes" TEXT NOT NULL DEFAULT '["admin"]';

