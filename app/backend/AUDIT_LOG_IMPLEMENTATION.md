# Audit Log Implementation for High-Risk Admin Actions

## Overview
This document describes the audit logging implementation for high-risk admin actions across the Soter backend application.

## Implementation Summary

### 1. API Keys Service (`src/api-keys/api-keys.service.ts`)
**Actions Logged:**
- `api_key_created` - When a new API key is created
- `api_key_revoked` - When an API key is revoked
- `api_key_rotated` - When an API key is rotated (old revoked, new created)

**Metadata Captured:**
- Create: role, ngoId, description
- Revoke: reason
- Rotate: oldKeyId, newKeyId

### 2. Ledger Admin Services

#### Ledger Backfill Service (`src/onchain/ledger-backfill.service.ts`)
**Actions Logged:**
- `ledger_backfill_triggered` - When a ledger backfill job is triggered

**Metadata Captured:**
- startLedger, endLedger, campaignId, batchSize, totalCount
- Actor: system:admin

#### Ledger Reconciliation Service (`src/onchain/ledger-reconciliation.service.ts`)
**Actions Logged:**
- `ledger_reconciliation_triggered` - When a ledger reconciliation job is triggered

**Metadata Captured:**
- startLedger, endLedger, campaignId, thresholdPercent, totalLedgers
- Actor: system:admin

### 3. Invites Service (`src/orgs/invites.service.ts`)
**Actions Logged:**
- `invite_created` - When an invite is created
- `invite_accepted` - When an invite is accepted
- `invite_revoked` - When an invite is revoked

**Metadata Captured:**
- Create: orgId, email, role
- Accept: orgId, role
- Revoke: orgId

### 4. Campaigns Service (`src/campaigns/campaigns.service.ts`)
**Actions Logged:**
- `campaign_created` - When a campaign is created
- `campaign_updated` - When a campaign is updated
- `campaign_archived` - When a campaign is archived

**Metadata Captured:**
- Create: name, budget, status, ngoId
- Update: changes (full DTO)
- Archive: name, previousStatus

### 5. Claims Service (`src/claims/claims.service.ts`)
**Actions Logged:**
- `claim_status_changed_to_verified` - When a claim is verified
- `claim_status_changed_to_approved` - When a claim is approved
- `claim_status_changed_to_disbursed` - When a claim is disbursed
- `disburse` - On-chain disbursement operation
- `disburse_failed` - Failed on-chain disbursement
- `expired_cleanup` - Automated cleanup of expired claims

**Metadata Captured:**
- Status changes: from, to, campaignId, onchainResult (transactionHash, status)
- Disburse: transactionHash, status, amountDisbursed, adapter
- Failed disburse: error, adapter
- Expired cleanup: previousStatus, nextStatus, expiresAt, onchain metadata

### 6. Cancel and Reissue Service (`src/claims/cancel-and-reissue.service.ts`)
**Actions Logged:**
- `claim.cancelled` - When a claim is cancelled
- `claim.reissued` - When a claim is reissued (cancel + create new)

**Metadata Captured:**
- Cancel: claimId, campaignId, operatorId, reason, unlockedAmount, timestamp
- Reissue: newClaimId, originalClaimId, campaignId, operatorId, amount, reason, timestamp

## Audit Log Schema

The audit logs are stored in the `AuditLog` Prisma model with the following structure:

```prisma
model AuditLog {
  id        String    @id @default(cuid())
  actorId   String
  entity    String
  entityId  String
  action    String
  timestamp DateTime  @default(now())
  metadata  Json?
  deletedAt DateTime?

  @@index([entity, entityId])
  @@index([timestamp])
  @@index([deletedAt])
}
```

## Querying Audit Logs

Audit logs can be queried via the existing audit endpoints:

- `GET /audit` - Query audit logs with filters (entity, entityId, actorId, action, startTime, endTime, page, limit)
- `GET /audit/export` - Export anonymized audit logs as JSON or CSV

## Security Considerations

1. **Actor Identification**: All audit logs capture the actor ID from the request context (user ID, API key ID, or system)
2. **Anonymization**: The export endpoint anonymizes sensitive data using SHA-256 hashing
3. **Retention**: Audit logs are subject to the retention policy configured in the system
4. **Immutability**: Audit logs are never modified, only soft-deleted via retention policies

## Testing

To test the audit logging implementation:

```bash
cd app/backend
npm test -- --testPathPattern=audit
```

## Notes

- The lint errors shown in the IDE are related to missing npm dependencies and will resolve when the project is properly installed
- All audit logging is asynchronous and failures are logged but do not block the main operation
- The audit module is globally available across the application via the `AuditModule`
