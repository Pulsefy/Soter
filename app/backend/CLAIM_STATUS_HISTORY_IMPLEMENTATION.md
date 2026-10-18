# Claim Status History Endpoint Implementation (Issue #1177)

## Overview

Implemented a recipient-facing and caseworker-facing API endpoint that allows authorized users to retrieve the chronological status history of a claim. The endpoint shows all status transitions with timestamps and actor information.

## Endpoint

```
GET /claims/:id/status-history
```

### Route Details
- **Method**: GET
- **Path**: `/claims/{claimId}/status-history`
- **Authentication**: Required (Bearer JWT token)
- **Authorization**: Enforces organization access control (NGO users see only their org's claims; admins see all)
- **Response Format**: JSON

## Response Example

```json
{
  "claimId": "claim-uuid-123",
  "history": [
    {
      "previousStatus": null,
      "newStatus": "requested",
      "timestamp": "2026-01-01T10:00:00.000Z",
      "actor": null,
      "trigger": "claim_creation",
      "metadata": {}
    },
    {
      "previousStatus": "requested",
      "newStatus": "verified",
      "timestamp": "2026-01-01T11:00:00.000Z",
      "actor": "operator-001",
      "trigger": "manual_verification",
      "metadata": {
        "verificationScore": 0.95
      }
    },
    {
      "previousStatus": "verified",
      "newStatus": "approved",
      "timestamp": "2026-01-01T12:00:00.000Z",
      "actor": "admin-001",
      "trigger": "manual_approval",
      "metadata": {}
    },
    {
      "previousStatus": "approved",
      "newStatus": "disbursed",
      "timestamp": "2026-01-01T13:00:00.000Z",
      "actor": "system",
      "trigger": "on_chain_disbursement",
      "metadata": {}
    }
  ],
  "historicalCoverageStart": "2026-01-01T10:00:00.000Z",
  "historicalCoverageNote": null
}
```

## Status History Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `previousStatus` | string \| null | The status before this transition |
| `newStatus` | string | The status after this transition |
| `timestamp` | string (ISO-8601) | When the transition occurred |
| `actor` | string \| null | Who or what caused the transition (operator ID, "system", etc.) |
| `trigger` | string | Type of trigger: `manual_verification`, `manual_approval`, `manual_cancellation`, `manual_archive`, `on_chain_disbursement`, `status_change` |
| `metadata` | object | Additional context (verificationScore, cancelReasonCode, cancelReason, etc.) |

## Implementation Details

### Database
- **Data Source**: Existing `AuditLog` table (no new migration needed)
- **Query**: Filters for `entity="claim"` and `action LIKE "status_changed_to_%"`, ordered chronologically
- **Coverage**: Complete history from claim creation onwards; incomplete if records existed before feature deployment

### Components Added

#### 1. DTO (app/backend/src/claims/dto/claim-status-history.dto.ts)
- `ClaimStatusHistoryEntryDto` - Single status transition entry
- `ClaimStatusHistoryDto` - Complete history response

#### 2. Service Method (app/backend/src/claims/claims.service.ts)
```typescript
async getStatusHistory(claimId: string): Promise<ClaimStatusHistoryDto>
```
- Retrieves claim by ID (throws NOT_FOUND if missing or soft-deleted)
- Queries all status change audit logs in chronological order
- Transforms logs into history entries with actor, trigger, and metadata extraction
- Detects and documents incomplete historical coverage

#### 3. Controller Endpoint (app/backend/src/claims/claims.controller.ts)
```typescript
@Get(':id/status-history')
async getStatusHistory(@Param('id') id: string, @Request() req): Promise<ClaimStatusHistoryDto>
```
- Enforces organization access control via `ensureOrgAccess()`
- Delegates to service for history retrieval
- Returns 403 Forbidden if user doesn't have access
- Returns 404 Not Found if claim doesn't exist

### Authorization

The endpoint enforces the existing organization-scoped access model:

1. **Admin Role**: Unrestricted access to any claim's history
2. **NGO Role**: Access only to claims in their organization (verified via `campaign.orgId`)
3. **Other Roles**: Subject to existing endpoint-level access rules

Authorization is performed by:
1. Loading the claim and its campaign relationship
2. Calling `ensureOrgAccess()` which validates user against campaign's organization
3. Throwing `AppException(FORBIDDEN, 403)` if access is denied

## Tests

### Unit Tests

**File**: `app/backend/src/claims/claim-status-history.spec.ts`
- Controller-level tests for authorization and response format
- Tests for access denial scenarios
- Tests for handling missing claims

**File**: `app/backend/src/claims/claim-status-history-service.spec.ts`
- Service-level tests for history transformation
- Tests for empty history handling
- Tests for metadata extraction (verification scores, cancel reasons)
- Tests for trigger type inference
- Tests for chronological ordering
- Tests for historical coverage detection
- Tests for timestamp formatting (ISO-8601)

### Test Coverage

The implementation includes tests for:

1. ✅ **Chronological Ordering**: History entries are ordered oldest to newest
2. ✅ **Timestamp Inclusion**: Each entry includes ISO-8601 formatted timestamp
3. ✅ **Actor Identification**: Actor (operator ID, system) identified where available
4. ✅ **Trigger Attribution**: Transition reason (manual_verification, on_chain_disbursement, etc.)
5. ✅ **Authorization Boundaries**: Unauthorized access denied, authorized users see data
6. ✅ **Non-Existent Claims**: Returns 404 for missing claims
7. ✅ **Empty History**: Handles claims with no recorded transitions with explanatory note
8. ✅ **Metadata Preservation**: Cancellation codes/reasons, verification scores preserved
9. ✅ **Historical Coverage**: Detects and documents incomplete history when applicable
10. ✅ **Deleted Claims**: Returns 404 for soft-deleted claims

## Historical Data Handling

### Complete History Available
If the deployment began tracking status changes from claim creation, the history is complete. The `historicalCoverageNote` field is null or omitted.

### Incomplete History (Post-Deployment Deployment)
If claims were created before this feature was deployed:
- The `history` array starts from the first recorded transition
- `historicalCoverageStart` shows claim creation time
- `historicalCoverageNote` explains: "Incomplete history. Status history begins from the first recorded transition and may not include claim creation or early transitions."

### No Recorded Transitions
If a claim exists but has no status change audit logs (rare, but possible for very old claims):
- `history` is an empty array
- `historicalCoverageNote` explains: "No status transitions recorded. Claim may have been created before status history tracking was implemented."

This design ensures clients are never misled by historical gaps.

## Error Responses

### 404 Not Found
- Claim doesn't exist
- Claim is soft-deleted

```json
{
  "code": 404,
  "message": "Claim not found",
  "errorCode": "NOT_FOUND"
}
```

### 403 Forbidden
- User is authenticated but belongs to a different organization (NGO role)
- User has insufficient permissions for this resource

```json
{
  "code": 403,
  "message": "Access denied: resource belongs to a different organization",
  "errorCode": "FORBIDDEN"
}
```

### 401 Unauthorized
- No authentication token provided
- Token is invalid or expired

## Integration with Existing Workflows

Status transitions are recorded automatically when claims reach these milestones:

1. **Claim Creation**: `requested` status
2. **Verification**: `requested` → `verified` (manual or via verification pipeline completion)
3. **Approval**: `verified` → `approved` (manual approval by admin)
4. **Disbursement**: `approved` → `disbursed` (manual disbursement, schedules Soroban transaction)
5. **Archival**: `disbursed` → `archived` (soft-archive for historical record)
6. **Cancellation**: Any active status → `cancelled` (manual cancellation with reason code)
7. **Reissuance**: Original `cancelled` (with code `reissued`), new claim `requested`
8. **Expiration Cleanup**: `approved` → `archived` (automatic when expiry date reached)

Each transition creates an AuditLog entry with:
- `entity: "claim"`
- `action: "status_changed_to_{NEW_STATUS}"`
- `metadata: { from: string, to: string, ...context }`

The history endpoint queries and transforms these records.

## Files Changed

1. **Created**: `app/backend/src/claims/dto/claim-status-history.dto.ts` - Response DTOs
2. **Created**: `app/backend/src/claims/claim-status-history.spec.ts` - Controller tests
3. **Created**: `app/backend/src/claims/claim-status-history-service.spec.ts` - Service tests
4. **Created**: `app/backend/CLAIM_STATUS_HISTORY_IMPLEMENTATION.md` - This documentation
5. **Modified**: `app/backend/src/claims/claims.service.ts` - Added `getStatusHistory()` method
6. **Modified**: `app/backend/src/claims/claims.controller.ts` - Added endpoint and imports

## Limitations

1. **Historical Coverage**: Statuses are tracked from when this feature is deployed. Pre-deployment claim history is unavailable. The API transparently documents this via `historicalCoverageNote`.

2. **Metadata Preservation**: Only metadata already captured in AuditLog entries is included. If metadata about a status change wasn't recorded originally, it cannot be reconstructed.

3. **Actor Tracking**: Actor information depends on what was recorded in the audit log at transition time. Early transitions may have incomplete actor information if the original audit service didn't capture it.

4. **Real-Time Updates**: This is a read-only endpoint. Status history is updated asynchronously when transitions occur. There is no real-time push notification of status changes.

## Acceptance Criteria - Verification

- [x] A working GET endpoint returns claim status history.
- [x] History entries are ordered from oldest to newest and include timestamps.
- [x] Each transition identifies its actor or trigger where that information is available.
- [x] Relevant status transitions are recorded by the existing application workflows.
- [x] Access is restricted to authorized users within the claim's campaign or organization scope.
- [x] Existing history is backfilled where reliable data is available (AuditLog), or the start of historical coverage is explicitly documented.
- [x] Appropriate validation and error handling are implemented.
- [x] Automated tests cover the endpoint, ordering, transition recording, and authorization boundaries.
- [x] Existing functionality and tests remain intact.

## Next Steps (Post-MVP)

- Consider adding pagination for very large histories (100+ transitions)
- Consider exporting history as CSV for long-term archival
- Consider webhooks to notify external systems of status changes
- Consider storing additional context (IP address, User-Agent) on sensitive transitions

## Deployment Notes

- **Zero Migration Required**: Uses existing `AuditLog` table
- **Backwards Compatible**: Existing endpoints and tests unaffected
- **Safe for Existing Data**: Queries are read-only against audit logs
- **Historical Data Automatically Used**: All existing audit logs are immediately queryable via this endpoint
- **No Performance Impact**: Queries filtered by `entityId` (indexed) and ordered by `timestamp` (indexed)
