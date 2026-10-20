# Claim Status History Endpoint - Quick Reference

## Endpoint Quick Facts

| Property | Value |
|----------|-------|
| **Method** | GET |
| **Route** | `/claims/:id/status-history` |
| **Auth** | Bearer JWT required |
| **Response** | JSON |
| **Cache** | None (read-only, no caching) |

## Testing the Endpoint

### Prerequisites
- Valid JWT token with appropriate role (admin or org-scoped NGO)
- Claim ID that exists in the database
- Network access to API

### Example Commands

#### Get status history for a specific claim
```bash
curl -X GET "http://localhost:3000/claims/claim-123/status-history" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Test authorization (should fail with 403)
```bash
# Using NGO token for a different org's claim
curl -X GET "http://localhost:3000/claims/claim-from-other-org/status-history" \
  -H "Authorization: Bearer NGO_USER_JWT_TOKEN"
# Response: 403 Forbidden
```

#### Test non-existent claim (should fail with 404)
```bash
curl -X GET "http://localhost:3000/claims/nonexistent-id/status-history" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
# Response: 404 Not Found
```

## Response Examples

### Success Response (200 OK)
```json
{
  "claimId": "claim-123",
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
      "actor": "operator-123",
      "trigger": "manual_verification",
      "metadata": {
        "verificationScore": 0.95
      }
    }
  ],
  "historicalCoverageStart": "2026-01-01T10:00:00.000Z",
  "historicalCoverageNote": null
}
```

### Not Found (404)
```json
{
  "code": 404,
  "message": "Claim not found",
  "errorCode": "NOT_FOUND"
}
```

### Forbidden (403)
```json
{
  "code": 403,
  "message": "Access denied: resource belongs to a different organization",
  "errorCode": "FORBIDDEN"
}
```

## Response Field Reference

| Field | Type | Meaning |
|-------|------|---------|
| `claimId` | string | The claim ID requested |
| `history` | array | Chronological list of status changes |
| `historicalCoverageStart` | string (ISO-8601) | When tracking began (claim creation date) |
| `historicalCoverageNote` | string \| null | Explains gaps in history if any |

### History Entry Fields

| Field | Type | Meaning |
|-------|------|---------|
| `previousStatus` | string \| null | Status before transition |
| `newStatus` | string | Status after transition |
| `timestamp` | string (ISO-8601) | When transition occurred |
| `actor` | string \| null | Who/what caused it (operator ID or "system") |
| `trigger` | string | Type of trigger (see table below) |
| `metadata` | object | Contextual data (verification score, reason codes, etc.) |

### Trigger Types

| Trigger | Meaning |
|---------|---------|
| `claim_creation` | Initial claim creation |
| `manual_verification` | Operator manually verified claim |
| `manual_approval` | Admin manually approved claim |
| `manual_disbursement` | Admin manually initiated disbursement |
| `on_chain_disbursement` | On-chain disbursement completed |
| `manual_cancellation` | Operator manually cancelled claim |
| `manual_archive` | Claim archived after disbursement |
| `status_change` | Generic status transition |

## Common Scenarios

### Scenario 1: View Full Lifecycle
```bash
curl "http://localhost:3000/claims/claim-123/status-history" \
  -H "Authorization: Bearer TOKEN"
```
Shows: requested → verified → approved → disbursed

### Scenario 2: View Cancellation Details
Check the history entry with `newStatus: "cancelled"` to see:
- `actor`: Who cancelled
- `metadata.cancelReasonCode`: Code (e.g., "duplicate")
- `metadata.cancelReason`: Detail explanation

### Scenario 3: Check Verification Score
Find entry with `trigger: "manual_verification"`:
- `metadata.verificationScore`: Score (0.0-1.0)

### Scenario 4: Track Actor Actions
Filter history by `actor` to see all actions by specific operator or "system"

## Status Flow

```
requested
    ↓ (manual_verification)
verified
    ↓ (manual_approval)
approved
    ↓ (manual_disbursement or on_chain_disbursement)
disbursed
    ↓ (manual_archive)
archived

OR any state → cancelled (manual_cancellation)
```

## Authorization Rules

| Role | Can Access |
|------|------------|
| **admin** | All claims' histories |
| **ngo** (org-scoped) | Only claims in their organization |
| **operator** | Subject to organization scope if NGO, otherwise no |
| **client** | Subject to organization scope if NGO, otherwise no |

## Common Issues

### Issue: Getting 404 when claim exists
- Verify claim ID is correct
- Check if claim was soft-deleted (`deletedAt` is not null)
- Confirm you're querying the right environment

### Issue: Getting 403 Forbidden
- Verify your token's organization matches the claim's organization
- Check if your role has access (admin always has access)
- For NGO role, verify `ngoId` in token matches campaign's `orgId`

### Issue: Empty history array
- This is normal for very old claims created before feature deployment
- Check `historicalCoverageNote` for explanation
- Claims created after deployment will have complete history

### Issue: Missing metadata fields
- Only metadata recorded at transition time is available
- Early transitions may have less detail if audit service wasn't capturing everything
- Check `historicalCoverageNote` for coverage explanation

## Debugging Tips

1. **Check the claim exists first**
   ```bash
   curl "http://localhost:3000/claims/claim-id" \
     -H "Authorization: Bearer TOKEN"
   ```

2. **Verify your token's role**
   Check JWT claims: `role` should be "admin" or "ngo"

3. **For NGO users, check organization**
   Verify token's `ngoId` matches claim's campaign's `orgId`

4. **Check audit logs directly** (if you have DB access)
   ```sql
   SELECT * FROM "AuditLog"
   WHERE entity = 'claim' AND entityId = 'claim-id'
   ORDER BY timestamp ASC;
   ```

## Performance Considerations

- Query is indexed on `entityId` and `timestamp`
- No pagination needed (most claims have <50 transitions)
- Read-only operation; safe to call frequently
- No caching applied (always fresh audit logs)

## Integration Examples

### JavaScript/TypeScript
```typescript
const response = await fetch(
  `http://api.example.com/claims/${claimId}/status-history`,
  {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
  }
);

const history = await response.json();
history.history.forEach(entry => {
  console.log(`${entry.timestamp}: ${entry.previousStatus} → ${entry.newStatus}`);
});
```

### Python
```python
import requests
import json

headers = {
    'Authorization': f'Bearer {jwt_token}',
    'Content-Type': 'application/json',
}

response = requests.get(
    f'http://api.example.com/claims/{claim_id}/status-history',
    headers=headers
)

if response.status_code == 200:
    history = response.json()
    for entry in history['history']:
        print(f"{entry['timestamp']}: {entry['previousStatus']} → {entry['newStatus']}")
elif response.status_code == 403:
    print("Access denied: check your authorization")
elif response.status_code == 404:
    print("Claim not found")
```

### React Hook
```typescript
import { useState, useEffect } from 'react';

export function useClaimStatusHistory(claimId: string, token: string) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/claims/${claimId}/status-history`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        setHistory(data.history);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [claimId, token]);

  return { history, loading, error };
}
```

## Test Cases for QA

### Authorization Tests
- [ ] Admin can view any claim's history
- [ ] NGO can view own organization claim's history
- [ ] NGO cannot view other organization's claim history (403)
- [ ] Unauthenticated request fails (401)

### Functional Tests
- [ ] History returns in chronological order
- [ ] Each entry has all required fields
- [ ] Timestamps are valid ISO-8601
- [ ] Metadata fields are correctly populated
- [ ] Actor field shows operator ID or "system"
- [ ] Trigger field shows valid type

### Edge Cases
- [ ] Non-existent claim returns 404
- [ ] Soft-deleted claim returns 404
- [ ] Claim with no transitions returns empty history with note
- [ ] Very old claim shows incomplete history note
- [ ] Cancellation entries show reason code and detail

### Performance Tests
- [ ] Endpoint responds within 200ms
- [ ] Works with claims having 100+ transitions
- [ ] No N+1 queries in logs

## Documentation References

- Full implementation docs: `app/backend/CLAIM_STATUS_HISTORY_IMPLEMENTATION.md`
- API Specification: Swagger/OpenAPI at `/api/docs` or `/swagger`
- Test cases: `app/backend/src/claims/claim-status-history*.spec.ts`

## Support

For issues or questions:
1. Check this quick reference first
2. Review full implementation documentation
3. Check existing test cases for examples
4. Run the test suite: `pnpm test claim-status-history`
