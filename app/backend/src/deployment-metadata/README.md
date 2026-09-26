# Deployment Metadata Module

This module provides API endpoints and database persistence for contract deployment metadata, enabling the backend to report currently configured contracts and their provenance.

## Overview

The Deployment Metadata module stores information about smart contract deployments, including:
- **Contract ID**: The deployed contract address
- **Network**: Where the contract is deployed (testnet, mainnet, etc.)
- **WASM Hash**: Hash of the deployed WASM binary
- **Deployed At**: When the contract was deployed
- **Commit SHA**: Git commit reference for code traceability
- **Deployer**: Address or identifier of the deployer
- **Transaction Hash**: Hash of the deployment transaction
- **Metadata**: Additional deployment context (environment, flags, etc.)

## Architecture

```
┌─────────────────────────────────────┐
│   DeploymentMetadataController      │
│   (REST API - Admin Only)           │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  DeploymentMetadataService          │
│  (Business Logic Layer)             │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   PrismaService                     │
│   (Database Persistence)            │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   SQLite Database                   │
│   (DeploymentMetadata Table)        │
└─────────────────────────────────────┘
```

## API Endpoints

All endpoints are protected with Bearer token authentication and require admin role.

### Create Deployment Metadata
```http
POST /deployment-metadata
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "contractName": "AidEscrow",
  "network": "testnet",
  "contractId": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
  "wasmHash": "24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d",
  "deployedAt": "2026-06-03T12:00:00Z",
  "commitSha": "abc123def456",
  "deployer": "GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY",
  "transactionHash": "292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64",
  "metadata": {
    "version": "1.0.0",
    "environment": "testnet"
  }
}

Response: 201 Created
{
  "id": "cuid-generated-id",
  "contractName": "AidEscrow",
  "network": "testnet",
  "contractId": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
  "wasmHash": "24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d",
  "deployedAt": "2026-06-03T12:00:00Z",
  "commitSha": "abc123def456",
  "deployer": "GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY",
  "transactionHash": "292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64",
  "metadata": {...},
  "createdAt": "2026-06-03T12:00:00Z",
  "updatedAt": "2026-06-03T12:00:00Z"
}
```

### List All Deployment Metadata
```http
GET /deployment-metadata
Authorization: Bearer <admin-token>

Response: 200 OK
[
  {
    "id": "...",
    "contractName": "AidEscrow",
    "network": "testnet",
    ...
  }
]
```

### Get Deployments by Network
```http
GET /deployment-metadata/by-network/:network
Authorization: Bearer <admin-token>

Example:
GET /deployment-metadata/by-network/testnet

Response: 200 OK
[
  {
    "id": "...",
    "contractName": "AidEscrow",
    "network": "testnet",
    ...
  }
]
```

### Get Deployment by Network and Contract Name
```http
GET /deployment-metadata/by-contract/:network/:contractName
Authorization: Bearer <admin-token>

Example:
GET /deployment-metadata/by-contract/testnet/AidEscrow

Response: 200 OK
{
  "id": "...",
  "contractName": "AidEscrow",
  "network": "testnet",
  "contractId": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
  ...
}
```

### Get Deployment by Contract ID
```http
GET /deployment-metadata/by-contract-id/:contractId
Authorization: Bearer <admin-token>

Example:
GET /deployment-metadata/by-contract-id/CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG

Response: 200 OK
{
  "id": "...",
  "contractName": "AidEscrow",
  "contractId": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
  ...
}
```

### Update Deployment Metadata
```http
PUT /deployment-metadata/:id
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "commitSha": "new-commit-sha",
  "metadata": {
    "updated": true
  }
}

Response: 200 OK
{
  "id": "...",
  "contractName": "AidEscrow",
  "commitSha": "new-commit-sha",
  ...
}
```

### Delete Deployment Metadata
```http
DELETE /deployment-metadata/:id
Authorization: Bearer <admin-token>

Response: 204 No Content
```

## Database Schema

The `DeploymentMetadata` table in SQLite includes:

| Column | Type | Constraints | Description |
|--------|------|-----------|-------------|
| `id` | String | PRIMARY KEY | CUID auto-generated ID |
| `contractName` | String | NOT NULL | Contract identifier (e.g., "AidEscrow") |
| `network` | String | NOT NULL | Network name (e.g., "testnet", "mainnet") |
| `contractId` | String | NOT NULL | Deployed contract address |
| `wasmHash` | String | NOT NULL | WASM binary hash |
| `deployedAt` | DateTime | NOT NULL | Deployment timestamp |
| `commitSha` | String | NULL | Git commit SHA |
| `deployer` | String | NULL | Deployer address/ID |
| `transactionHash` | String | NULL | Deployment transaction hash |
| `metadata` | JSON | NULL | Additional deployment context |
| `createdAt` | DateTime | NOT NULL DEFAULT NOW() | Record creation time |
| `updatedAt` | DateTime | NOT NULL | Record update time |

**Unique Constraint**: `(network, contractName)` - ensures one deployment per contract per network

**Indices**:
- `network` - for network-based queries
- `contractId` - for contract ID lookups
- `deployedAt` - for chronological queries

## Tenant Safety

The module implements tenant-safety through:

1. **Network Isolation**: Each network (testnet, mainnet) maintains separate deployment records
2. **Unique Constraint**: Prevents duplicate deployments of the same contract on the same network
3. **Admin-Only Access**: All endpoints require admin role authentication
4. **Audit Trail**: Tracks creation and update timestamps

## Testing

### Unit Tests
Located in `deployment-metadata.service.spec.ts`:
- Service method testing with mocked Prisma
- Tenant isolation verification
- Unique constraint enforcement
- CRUD operations

### Integration Tests
Located in `test/deployment-metadata.e2e-spec.ts`:
- Full HTTP endpoint testing
- Database persistence verification
- Authorization and role checks
- Tenant safety validation

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Run specific test
npm run test:e2e -- deployment-metadata.e2e-spec
```

## Seeding

Default deployment metadata is seeded for development:

```json
{
  "contractName": "AidEscrow",
  "network": "testnet",
  "contractId": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
  "wasmHash": "24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d",
  "deployedAt": "2026-06-03T12:00:00Z",
  "commitSha": "abc123def456",
  "deployer": "GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY",
  "transactionHash": "292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64",
  "metadata": {
    "uploadTxHash": "f61ca00143125d29f9932b5b50e499d9ab5dde8f2a849637a64d84cd1dcb9103",
    "stellarExplorerUrl": "https://stellar.expert/explorer/testnet/tx/...",
    "contractUrl": "https://lab.stellar.org/r/testnet/contract/...",
    "version": "1.0.0"
  }
}
```

## Migration

The migration `20260603000000_add_deployment_metadata` creates the `DeploymentMetadata` table and indices.

To apply the migration:
```bash
npm run prisma:deploy
```

## Future Enhancements

1. **Multi-Tenant Support**: Associate deployments with organizations
2. **Deployment History**: Track deployment versions and rollbacks
3. **Contract Verification**: Link to contract source code and audits
4. **Monitoring Integration**: Connect to observability platforms
5. **API Versioning**: Support multiple contract versions per network
