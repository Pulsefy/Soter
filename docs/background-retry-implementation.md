# Background Retry for Pending Claim Submissions

## Overview

This document describes the implementation of background retry functionality for pending claim disbursements in the Soter platform. The system now automatically retries failed on-chain disbursement operations and provides monitoring for stuck claims.

## Problem Statement

Previously, when a claim disbursement failed on-chain:
- The claim status would still transition to "disbursed" even if the on-chain operation failed
- No automatic retry mechanism existed for transient failures
- Failed disbursements required manual intervention
- No monitoring for claims stuck in pending states

## Solution Architecture

### 1. New Claim Status: `disbursing`

Added a new intermediate status to track claims that are actively being processed on-chain:

**Status Flow:**
```
requested → verified → approved → disbursing → disbursed → archived
                              ↓
                         approved (on failure)
```

### 2. Background Job Processing

Modified the disbursement flow to use BullMQ for background processing:

**Previous Flow:**
1. Admin calls `POST /claims/:id/disburse`
2. System calls on-chain adapter synchronously
3. Claim transitions to `disbursed` (even if on-chain fails)

**New Flow:**
1. Admin calls `POST /claims/:id/disburse`
2. Claim transitions to `disbursing`
3. Disbursement job is enqueued to BullMQ
4. Background processor executes on-chain operation
5. On success: Claim transitions to `disbursed`
6. On failure: Job retries with exponential backoff
7. After max retries: Claim reverts to `approved`

### 3. Automatic Retry Mechanism

**Retry Configuration:**
- **Max attempts:** 5 (configurable via `CLAIM_MAX_RETRY_ATTEMPTS`)
- **Backoff strategy:** Exponential
- **Initial delay:** 2 seconds
- **Queue:** `onchain`

**Transient Error Detection:**
The system automatically retries on transient errors:
- Network timeouts
- RPC congestion
- Rate limiting
- `tx_too_late` errors

### 4. Background Retry Service

Created `ClaimRetryService` to monitor and handle stuck disbursements:

**Features:**
- Runs every 5 minutes via cron job
- Identifies claims stuck in `disbursing` status for >30 minutes
- Re-enqueues missing jobs for stuck claims
- Reverts claims to `approved` after max retry attempts
- Generates alerts for failed operations

**Configuration:**
- `CLAIM_MAX_DISBURSING_DURATION`: 30 minutes (default)
- `CLAIM_MAX_RETRY_ATTEMPTS`: 5 (default)

### 5. Monitoring and Alerting

**Metrics Tracked:**
- Number of claims in `disbursing` status
- Number of stuck disbursements
- Number of recently failed disbursements
- Retry attempt counts

**Alerting:**
- Logs errors for stuck claims
- Generates structured alert messages
- TODO: Integration with external monitoring systems (Slack, Datadog, etc.)

## Implementation Details

### Database Schema Changes

**Migration:** `20260529000000_add_disbursing_status`

Added `disbursing` status to `ClaimStatus` enum:
```prisma
enum ClaimStatus {
  requested
  verified
  approved
  disbursing  // NEW
  disbursed
  archived
  cancelled
}
```

### Modified Files

1. **`prisma/schema.prisma`**
   - Added `disbursing` status to ClaimStatus enum

2. **`src/claims/claims.service.ts`**
   - Added BullMQ queue injection
   - Modified `disburse()` method to enqueue background job
   - Transitions claim to `disbursing` before enqueuing

3. **`src/onchain/onchain.processor.ts`**
   - Added PrismaService injection
   - Added `updateClaimStatus()` method
   - Added `revertClaimStatus()` method
   - Updates claim status on successful disbursement
   - Reverts claim status after max retries

4. **`src/claims/claim-retry.service.ts`** (NEW)
   - Monitors stuck disbursements
   - Re-enqueues missing jobs
   - Reverts claims after max retries
   - Provides monitoring statistics

5. **`src/claims/claims.module.ts`**
   - Added ClaimRetryService to providers

6. **`src/onchain/onchain.module.ts`**
   - Added PrismaModule to imports

## Configuration

Add the following environment variables to `.env`:

```bash
# Background retry configuration
CLAIM_MAX_DISBURSING_DURATION=1800000  # 30 minutes in milliseconds
CLAIM_MAX_RETRY_ATTEMPTS=5

# On-chain configuration
ONCHAIN_ENABLED=true
ONCHAIN_ADAPTER=mock  # or 'soroban'
REDIS_HOST=localhost
REDIS_PORT=6379
```

## API Changes

### Disburse Endpoint

**Request:** `POST /claims/:id/disburse`

**Response (immediate):**
```json
{
  "id": "claim_123",
  "status": "disbursing",
  "amount": 100.00,
  "createdAt": "2026-05-29T00:00:00Z",
  "updatedAt": "2026-05-29T00:00:00Z"
}
```

**Note:** The claim status is now `disbursing` instead of immediately `disbursed`. The actual disbursement happens in the background.

### Monitoring Endpoint

**Request:** `GET /claims/retry/stats` (TODO: implement endpoint)

**Response:**
```json
{
  "disbursing": 5,
  "stuck": 2,
  "recentlyFailed": 1
}
```

## Testing

### Manual Testing

1. Create and approve a claim
2. Call disburse endpoint
3. Verify claim status is `disbursing`
4. Wait for background job to process
5. Verify claim status transitions to `disbursed`
6. Simulate on-chain failure
7. Verify retry mechanism works
8. Verify claim reverts to `approved` after max retries

### Automated Testing

Add tests for:
- Claim status transitions
- Job enqueueing
- Background processing
- Retry logic
- Stuck claim detection
- Alert generation

## Troubleshooting

### Claims stuck in `disbursing` status

**Check:**
1. Redis connection is healthy
2. BullMQ worker is running
3. On-chain adapter is configured
4. Review logs for errors

**Resolution:**
- The `ClaimRetryService` will automatically handle stuck claims
- Manual intervention: Revert claim to `approved` and retry disbursement

### High retry failure rate

**Check:**
1. On-chain RPC endpoint health
2. Network connectivity
3. Account has sufficient funds
4. Contract is not paused

**Resolution:**
- Check Stellar network status
- Verify adapter configuration
- Review error logs for specific failure reasons

## Future Enhancements

1. **External Monitoring Integration**
   - Slack/Teams webhooks for alerts
   - Datadog/New Relic metrics
   - PagerDuty integration for critical failures

2. **Advanced Retry Strategies**
   - Circuit breaker pattern
   - Adaptive backoff based on error type
   - Priority queues for urgent disbursements

3. **Manual Override Capabilities**
   - Admin endpoint to force retry
   - Admin endpoint to cancel stuck disbursement
   - Bulk retry operations

4. **Enhanced Monitoring**
   - Real-time dashboard
   - Historical retry analytics
   - Performance metrics

## Migration Guide

### For Existing Deployments

1. Run database migration:
   ```bash
   npx prisma migrate deploy
   ```

2. Update environment variables
3. Restart backend services
4. Verify BullMQ worker is running
5. Monitor logs for any issues

### Rollback Plan

If issues arise:
1. Revert code changes
2. Rollback database migration
3. Claims in `disbursing` status can be manually reverted to `approved`

## Security Considerations

- Queue jobs contain sensitive data (recipient addresses, amounts)
- Redis connection should be secured
- Audit trail maintained for all status transitions
- Admin-only access to disbursement operations

## Performance Impact

- **Memory:** Minimal increase for queue processing
- **Database:** Additional queries for status updates
- **Network:** Background processing reduces API response time
- **Redis:** Required for BullMQ queue management

## Support

For issues or questions:
- Check logs: `ClaimRetryService`, `OnchainProcessor`
- Review queue status via BullMQ dashboard
- Monitor claim statuses in database
- Contact development team

---

**Implementation Date:** 2026-05-29  
**Version:** 1.0  
**Author:** Cascade AI Assistant
