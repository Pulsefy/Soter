-- CreateTable
CREATE TABLE "DeploymentMetadata" (
    "id" TEXT NOT NULL,
    "contractName" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "wasmHash" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "commitSha" TEXT,
    "deployer" TEXT,
    "transactionHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeploymentMetadata_network_idx" ON "DeploymentMetadata"("network");

-- CreateIndex
CREATE INDEX "DeploymentMetadata_contractId_idx" ON "DeploymentMetadata"("contractId");

-- CreateIndex
CREATE INDEX "DeploymentMetadata_deployedAt_idx" ON "DeploymentMetadata"("deployedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentMetadata_network_contractName_key" ON "DeploymentMetadata"("network", "contractName");

