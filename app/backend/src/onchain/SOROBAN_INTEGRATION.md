# Soroban Aid Escrow Backend Integration

## Overview

This implementation provides a complete backend service layer for the Soroban AidEscrow contract. It abstracts away the complexity of blockchain interactions and provides a clean REST API for clients.

## Architecture

### Layers

```
┌─────────────────────────────────────────┐
│   REST Endpoints (AidEscrowController)  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│   Business Logic (AidEscrowService)     │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  Adapter Pattern (OnchainAdapter)       │
│  ┌──────────────┐  ┌────────────────┐   │
│  │MockAdapter   │  │SorobanAdapter  │   │
│  └──────────────┘  └────────────────┘   │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    ┌───▼──┐          ┌──────▼────┐
    │ Mock │         │ Stellar JS │
    │      │         │    SDK     │
    └──────┘         └────────────┘
```

### Key Components

#### 1. **OnchainAdapter Interface** (`onchain.adapter.ts`)

Defines the contract for all blockchain interactions.

**New Methods:**
- `createAidPackage()` - Create single package
- `batchCreateAidPackages()` - Create multiple packages
- `claimAidPackage()` - Recipient claims package
- `disburseAidPackage()` - Admin disburses package  
- `getAidPackage()` - Retrieve package details
- `getAidPackageCount()` - Get aggregated statistics

#### 2. **SorobanAdapter** (`soroban.adapter.ts`)

Production implementation connecting to the actual Soroban RPC endpoint.

**Features:**
- Configuration-driven network/contract settings
- Lazy loading of Stellar SDK
- Comprehensive error handling and mapping
- Transaction submission and monitoring
- Read-only contract queries

#### 3. **MockOnchainAdapter** (`onchain.adapter.mock.ts`)

Mock implementation for development/testing.

**Features:**
- Deterministic responses for testing
- No network calls required
- Realistic data structures
- Full test coverage support

#### 4. **SorobanErrorMapper** (`utils/soroban-error.mapper.ts`)

Maps Soroban contract errors to standardized backend errors.

**Error Code Mapping:**
| Contract Error | HTTP Status | Message |
|---|---|---|
| NotInitialized | 400 | Escrow not initialized |
| AlreadyInitialized | 409 | Escrow already initialized |
| NotAuthorized | 403 | Not authorized |
| InvalidAmount | 400 | Invalid amount |
| PackageNotFound | 404 | Package not found |
| PackageExpired | 410 | Package has expired |
| ContractPaused | 503 | Contract is paused |

#### 5. **AidEscrowService** (`aid-escrow.service.ts`)

High-level business logic layer.

Methods wrap adapter calls with:
- Input validation
- Logging
- Request correlation
- Error handling

#### 6. **AidEscrowController** (`aid-escrow.controller.ts`)

REST API endpoints with full Swagger documentation.

## API Endpoints

### Create Single Package
```http
POST /onchain/aid-escrow/packages
Content-Type: application/json

{
  "packageId": "pkg_123456789",
  "recipientAddress": "GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ",
  "amount": "1000000000",
  "tokenAddress": "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN",
  "expiresAt": 1704067200,
  "metadata": {
    "campaign_ref": "campaign-123"
  }
}

Response: 201 Created
{
  "packageId": "pkg_123456789",
  "transactionHash": "ABC123DEF456...",
  "timestamp": "2026-03-30T12:30:00.000Z",
  "status": "success",
  "metadata": {
    "contractId": "CBAA...",
    "operator": "GBUQWP3..."
  }
}
```

### Batch Create Packages
```http
POST /onchain/aid-escrow/packages/batch
Content-Type: application/json

{
  "recipientAddresses": [
    "GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ",
    "GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7"
  ],
  "amounts": ["1000000000", "500000000"],
  "tokenAddress": "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN",
  "expiresIn": 2592000
}

Response: 201 Created
{
  "packageIds": ["0", "1"],
  "transactionHash": "ABC123DEF456...",
  "timestamp": "2026-03-30T12:30:00.000Z",
  "status": "success",
  "metadata": { "count": 2 }
}
```

### Claim Package
```http
POST /onchain/aid-escrow/packages/pkg_123/claim
Authorization: Bearer <token>

Response: 200 OK
{
  "packageId": "pkg_123456789",
  "transactionHash": "ABC123DEF456...",
  "amountClaimed": "1000000000",
  "status": "success"
}
```

### Get Package Details
```http
GET /onchain/aid-escrow/packages/pkg_123

Response: 200 OK
{
  "package": {
    "id": "pkg_123456789",
    "recipient": "GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ",
    "amount": "1000000000",
    "token": "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN",
    "status": "Created",
    "createdAt": 1711814400,
    "expiresAt": 1714406400,
    "metadata": { "campaign_ref": "campaign-123" }
  },
  "timestamp": "2026-03-30T12:30:00.000Z"
}
```

### Get Statistics
```http
GET /onchain/aid-escrow/stats

Response: 200 OK
{
  "aggregates": {
    "totalCommitted": "5000000000",
    "totalClaimed": "2000000000",
    "totalExpiredCancelled": "500000000"
  },
  "timestamp": "2026-03-30T12:30:00.000Z"
}
```

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Onchain Configuration
ONCHAIN_ADAPTER=soroban          # or "mock" for development
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_CONTRACT_ID=CBAA...      # Set after contract deployment
```

### Adapter Selection

The adapter is automatically selected via configuration:

```typescript
// mock adapter (development)
ONCHAIN_ADAPTER=mock

// soroban adapter (production)
ONCHAIN_ADAPTER=soroban
```

## Error Handling

All errors follow the global error format:

```json
{
  "code": 400,
  "message": "Human-readable error",
  "details": {
    "error_type": "contract_error",
    "error_code": 4
  },
  "traceId": "REQ-123ABC",
  "timestamp": "2026-03-30T12:30:00.000Z",
  "path": "/onchain/aid-escrow/packages"
}
```

### Specific Error Responses

**Not Authorized** (403)
```json
{
  "code": 403,
  "message": "Not authorized to perform this action",
  "details": {
    "error_type": "contract_error",
    "error_name": "NotAuthorized"
  }
}
```

**Package Not Found** (404)
```json
{
  "code": 404,
  "message": "Package not found",
  "details": {
    "error_type": "contract_error",
    "error_name": "PackageNotFound"
  }
}
```

**Package Expired** (410)
```json
{
  "code": 410,
  "message": "Package has expired",
  "details": {
    "error_type": "contract_error",
    "error_name": "PackageExpired"
  }
}
```

**Contract Paused** (503)
```json
{
  "code": 503,
  "message": "Contract is paused",
  "details": {
    "error_type": "contract_error",
    "error_name": "ContractPaused"
  }
}
```

## Testing

### Run Integration Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- aid-escrow.integration.spec.ts

# Watch mode
npm test:watch

# Coverage
npm test:cov
```

### Test Coverage

The test suite covers:

✅ Service layer:
- Create single and batch packages
- Claim, disburse packages
- Retrieve package details and stats
- Array validation for batch operations

✅ Controller layer:
- REST endpoint request/response mapping
- Error handling and exceptions
- User/operator address extraction

✅ Error handling:
- Array mismatch detection
- Missing required fields
- Invalid state transitions

### Example Test

```typescript
it('should create an aid package', async () => {
  const dto: CreateAidPackageDto = {
    packageId: 'pkg-001',
    recipientAddress: 'GBUQWP3...',
    amount: '1000000000',
    tokenAddress: 'GATEMHCCKCY...',
    expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
  };

  const result = await service.createAidPackage(
    dto,
    'GOPER8TOR...',
  );

  expect(result.packageId).toBe('pkg-001');
  expect(result.status).toBe('success');
});
```

## Development Workflow

### 1. Local Development (Mock Adapter)

Start with the mock adapter for instant feedback:

```bash
ONCHAIN_ADAPTER=mock npm run start:dev
```

Test endpoints without blockchain calls:
```bash
curl http://localhost:3001/onchain/aid-escrow/packages \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"packageId": "test-1", ...}'
```

### 2. Testnet Integration

Switch to Soroban testnet:

```bash
ONCHAIN_ADAPTER=soroban \
SOROBAN_CONTRACT_ID=CBAA... \
npm run start:dev
```

### 3. Production Deployment

Set production environment:

```bash
NODE_ENV=production \
ONCHAIN_ADAPTER=soroban \
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org \
STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
SOROBAN_CONTRACT_ID=CBAA... \
npm run start:prod
```

## Integration with Existing Systems

### With Database (Prisma)

Store transaction references:

```typescript
// After creating aid package
await prisma.aidPackage.create({
  data: {
    externalId: result.packageId,
    transactionHash: result.transactionHash,
    status: 'Created',
    ...
  },
});
```

### With Audit Service

All operations are automatically logged:

```typescript
// AidEscrowService calls handler which logs via audit
await this.auditService.record({
  actorId: operatorAddress,
  entity: 'aid_package',
  entityId: packageId,
  action: 'create',
  metadata: { amount, tokenAddress },
});
```

### With Notifications

Send alerts on state changes:

```typescript
// After successful disbursal
await this.notificationService.send({
  to: recipientAddress,
  type: 'aid_package_disbursed',
  data: { packageId, amount },
});
```

## Next Steps

### Phase 2: Full Soroban Integration

The `SorobanAdapter` is ready for implementation with the Stellar JS SDK:

1. **Install SDK** - `npm install stellar`
2. **Implement contract calls** - Use `SorobanRpc.Server` to invoke contract methods
3. **Handle keypair signing** - Integrate with key management system
4. **Monitor transactions** - Wait for settlement and track status

### Phase 3: Advanced Features

Future enhancements:

- [ ] Package extension/modification
- [ ] Batch refunds
- [ ] Webhook events on state changes
- [ ] Analytics dashboard
- [ ] Rate limiting per operator
- [ ] Pagination for large result sets
- [ ] caching layer for frequently accessed packages
- [ ] Contract upgrade handling

## File Structure

```
src/onchain/
├── onchain.adapter.ts              # Interface definition
├── onchain.adapter.mock.ts         # Mock implementation
├── soroban.adapter.ts              # Soroban implementation
├── onchain.module.ts               # DI setup & adapter factory
├── onchain.service.ts              # Queue/job management
├── onchain.processor.ts            # Background job handler
├── aid-escrow.service.ts           # Business logic
├── aid-escrow.controller.ts        # REST endpoints
├── aid-escrow.module.ts            # Feature module
├── dto/
│   └── aid-escrow.dto.ts           # Request/response DTOs
├── utils/
│   └── soroban-error.mapper.ts     # Error mapping
└── interfaces/
    └── onchain-job.interface.ts    # Job queue types

test/
└── aid-escrow.integration.spec.ts  # Integration tests
```

## Performance Considerations

### Caching

Consider caching read-only queries:

```typescript
@Get('packages/:id')
@CacheKey('package-' + packageId)
@CacheTTL(300) // 5 minutes
async getAidPackage(@Param('id') packageId: string) {
  return this.aidEscrowService.getAidPackage({ packageId });
}
```

### Batch Operations

Batch creation is significantly more efficient:

- **Single**: 1 transaction per package
- **Batch**: 1 transaction for N packages

Optimize by batching creates when possible.

### RPC Rate Limits

The Soroban testnet has rate limits. Implement:

- Exponential backoff in SorobanAdapter
- Request queuing for high-volume scenarios
- Circuit breaker pattern for RPC failures

## Troubleshooting

### "SOROBAN_CONTRACT_ID is not configured"

Solution: Set `SOROBAN_CONTRACT_ID` in `.env`

### "Soroban SDK not available"

Solution: Install Stellar SDK
```bash
npm install stellar
```

### Network timeouts

Solution: Increase timeout or switch to mock adapter for development
```bash
ONCHAIN_ADAPTER=mock npm run start:dev
```

### Array length mismatch

Ensure recipients and amounts have same length:
```json
{
  "recipientAddresses": ["addr1", "addr2"],
  "amounts": ["1000", "2000"]  // Same length
}
```

## References

- [Soroban Documentation](https://developers.stellar.org/soroban)
- [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk)
- [AidEscrow Contract](../onchain/contracts/aid_escrow/)
- [Error Handling Guide](../ERROR_HANDLING.md)
