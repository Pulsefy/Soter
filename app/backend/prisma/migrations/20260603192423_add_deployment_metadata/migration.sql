/*
  Warnings:

  - You are about to alter the column `metadata` on the `DeploymentMetadata` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeploymentMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractName" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "wasmHash" TEXT NOT NULL,
    "deployedAt" DATETIME NOT NULL,
    "commitSha" TEXT,
    "deployer" TEXT,
    "transactionHash" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_DeploymentMetadata" ("commitSha", "contractId", "contractName", "createdAt", "deployedAt", "deployer", "id", "metadata", "network", "transactionHash", "updatedAt", "wasmHash") SELECT "commitSha", "contractId", "contractName", "createdAt", "deployedAt", "deployer", "id", "metadata", "network", "transactionHash", "updatedAt", "wasmHash" FROM "DeploymentMetadata";
DROP TABLE "DeploymentMetadata";
ALTER TABLE "new_DeploymentMetadata" RENAME TO "DeploymentMetadata";
CREATE INDEX "DeploymentMetadata_network_idx" ON "DeploymentMetadata"("network");
CREATE INDEX "DeploymentMetadata_contractId_idx" ON "DeploymentMetadata"("contractId");
CREATE INDEX "DeploymentMetadata_deployedAt_idx" ON "DeploymentMetadata"("deployedAt");
CREATE UNIQUE INDEX "DeploymentMetadata_network_contractName_key" ON "DeploymentMetadata"("network", "contractName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
