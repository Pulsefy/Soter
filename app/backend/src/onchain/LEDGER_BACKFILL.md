# Ledger Backfill Tool

## Overview

The ledger backfill tool populates the `BalanceLedger` table with historical on-chain movement data from the AidEscrow contract. It processes ledger ranges in batches with durable checkpointing for safe resumption.

## Features

- **Durable Checkpointing**: Interrupted runs resume from `lastProcessedLedger` rather than restarting
- **Idempotent**: Existing entries are skipped based on ID
- **Batch Processing**: Configurable batch size to balance throughput and reliability
- **Dry-Run Mode**: Preview what would be created/updated without persisting anything

## API Usage

### Trigger a Backfill

```http
POST /admin/ledger/backfill
Content-Type: application/json

{
  "startLedger": 1000,
  "endLedger": 2000,
  "campaignId": "cmp_123",
  "batchSize": 100,
  "triggeredBy": "operator@example.com"
}
```

**Response:**
```json
{
  "jobId": "job_123",
  "checkpointId": "ckp_abc",
  "jobKey": "backfill:1000:2000",
  "startLedger": 1000,
  "endLedger": 2000,
  "status": "queued",
  "processedCount": 0,
  "skippedCount": 0,
  "errorCount": 0,
  "totalCount": 1001
}
```

### Dry-Run Mode

Preview what would be created/updated without persisting anything:

```http
POST /admin/ledger/backfill
Content-Type: application/json

{
  "startLedger": 1000,
  "endLedger": 2000,
  "campaignId": "cmp_123",
  "dryRun": true
}
```

**Response:**
```json
{
  "jobId": "dry-run",
  "jobKey": "backfill:1000:2000",
  "startLedger": 1000,
  "endLedger": 2000,
  "campaignId": "cmp_123",
  "status": "dry-run",
  "totalCount": 1001,
  "wouldCreate": 45,
  "wouldSkip": 12,
  "unattributable": 0,
  "countsByEventType": {
    "disburse": 30,
    "refund": 15
  },
  "sampleRecords": [
    {
      "id": "e1",
      "ledger": 1005,
      "eventType": "disburse",
      "amount": 1000,
      "txHash": "abc123",
      "packageId": "pkg_testnet"
    }
  ]
}
```

### Dry-Run Output Fields

- **wouldCreate**: Number of new entries that would be created
- **wouldSkip**: Number of entries that already exist and would be skipped
- **unattributable**: Number of entries that cannot be stored without a campaignId
- **countsByEventType**: Breakdown of entries by event type (disburse, refund, etc.)
- **sampleRecords**: Up to 10 sample records for inspection

### Monitor Progress

```http
GET /admin/ledger/backfill/checkpoint/:checkpointId
```

### List Recent Checkpoints

```http
GET /admin/ledger/backfill/checkpoints?limit=20
```

### Cancel a Running Backfill

```http
DELETE /admin/ledger/backfill/checkpoint/:checkpointId
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| startLedger | number | Yes | Starting ledger sequence number |
| endLedger | number | Yes | Ending ledger sequence number |
| campaignId | string | No | Campaign ID for attribution (required for persistence) |
| batchSize | number | No | Number of ledgers per batch (default: 100) |
| triggeredBy | string | No | Actor identifier for audit trail |
| dryRun | boolean | No | Preview without persisting (default: false) |

## Behavior

### Resumption Logic

- **No checkpoint**: Creates new checkpoint and enqueues job
- **Running checkpoint**: Returns 409 Conflict (job already in progress)
- **Failed/Cancelled checkpoint**: Resets status, resumes from `lastProcessedLedger`
- **Completed checkpoint**: Returns existing result immediately

### Idempotency

The tool checks for existing entries in the last 24 hours and skips duplicates based on entry ID. This ensures:
- Resumed runs don't create duplicates
- Retrying the same range is safe
- Existing data is never overwritten

### Campaign Attribution

`BalanceLedger.campaignId` is a required foreign key. The on-chain event stream carries no campaign attribution, so:
- **With campaignId**: Entries are persisted with the specified campaign
- **Without campaignId**: Dry-run reports unattributable count; real run throws error

## Dry-Run Best Practices

1. **Always dry-run first** against production data before running a real backfill
2. **Review the sample records** to ensure the data looks correct
3. **Check unattributable count** - if non-zero, provide a campaignId
4. **Verify counts by event type** match expectations
5. **Use the same range** for dry-run and real run to ensure consistency

The dry-run uses the same detection logic as the real run, so the preview accurately reflects what will be persisted.

## Error Handling

### Common Errors

**NotImplementedException**: "Backfill is not available against live data"
- Cause: No on-chain source configured
- Solution: Set `AID_ESCROW_CONTRACT_ID`, `STELLAR_RPC_URL`, and `STELLAR_HORIZON_URL`

**Error**: "Ledgers X-Y: N on-chain movement(s) cannot be stored without a campaignId"
- Cause: On-chain entries found but no campaignId provided
- Solution: Re-run with `campaignId` parameter

**ConflictException**: "A backfill job for ledger range X-Y is already running"
- Cause: Another job is processing this range
- Solution: Wait for completion or cancel the existing job

## Configuration

Required environment variables for backfill:
```bash
AID_ESCROW_CONTRACT_ID=CBAA...
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

## Example Workflow

```bash
# 1. Dry-run to preview
curl -X POST http://localhost:3001/admin/ledger/backfill \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "startLedger": 1000,
    "endLedger": 2000,
    "campaignId": "cmp_123",
    "dryRun": true
  }'

# 2. Review output, then run real backfill
curl -X POST http://localhost:3001/admin/ledger/backfill \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "startLedger": 1000,
    "endLedger": 2000,
    "campaignId": "cmp_123",
    "batchSize": 100,
    "triggeredBy": "operator@example.com"
  }'

# 3. Monitor progress
curl http://localhost:3001/admin/ledger/backfill/checkpoint/ckp_abc \
  -H "Authorization: Bearer $TOKEN"
```
