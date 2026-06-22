-- CreateTable
CREATE TABLE "DeploymentMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractName" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "wasmHash" TEXT NOT NULL,
    "deployedAt" DATETIME NOT NULL,
    "commitSha" TEXT,
    "deployer" TEXT,
    "transactionHash" TEXT,
    "metadata" JSON,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DeploymentMetadata_network_idx" ON "DeploymentMetadata"("network");

-- CreateIndex
CREATE INDEX "DeploymentMetadata_contractId_idx" ON "DeploymentMetadata"("contractId");

-- CreateIndex
CREATE INDEX "DeploymentMetadata_deployedAt_idx" ON "DeploymentMetadata"("deployedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentMetadata_network_contractName_key" ON "DeploymentMetadata"("network", "contractName");
