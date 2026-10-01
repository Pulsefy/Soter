# Error Response Comparison: Per-Key vs Organization Rate Limits

## Overview

The AI Service enforces two levels of rate limiting, each with a distinct error response to allow clients to handle them differently:

1. **Per-Key Rate Limit Exceeded** (existing)
2. **Organization Rate Limit Exceeded** (new, Issue #1200)

This document provides a detailed comparison of these two error responses so clients can reliably distinguish between them.

---

## Per-Key Rate Limit Exceeded

### When It Occurs

- An API key has made more requests than its configured per-key limit allows
- Example: Key limit is 60/minute, key has already made 60 requests, 61st request arrives

### HTTP Status

**429 Too Many Requests**

### Error Code

```
"code": "RATE_LIMIT_EXCEEDED"
```

### Example Response Body

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for API key. Please retry after the specified duration.",
    "details": {
      "limit": 60,
      "remaining": 0,
      "retry_after": 42,
      "reset_seconds": 42,
      "window_seconds": 60,
      "endpoint": "/v1/ai/inference"
    }
  }
}
```

### Response Headers

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42
```

### Distinguishing Characteristics

- Error code: `RATE_LIMIT_EXCEEDED`
- No `X-RateLimit-LimitType` header (defaults to per-key)
- Details include `endpoint` (the API path that hit the limit)
- Details do NOT include `organization_id`

---

## Organization Rate Limit Exceeded

### When It Occurs

- An organization has exceeded its organization-level rate limit ceiling
- Example: Organization limit is 100/minute, all keys from the org have collectively made 100 requests, another arrives
- Only occurs if:
  1. The API key is mapped to an organization
  2. The organization has a configured tier
  3. Organization-level limiting is enabled (`ORG_RATE_LIMIT_ENABLED=true`)

### HTTP Status

**429 Too Many Requests** (same as per-key, but distinct error code)

### Error Code

```
"code": "ORGANIZATION_RATE_LIMIT_EXCEEDED"
```

### Example Response Body

```json
{
  "error": {
    "code": "ORGANIZATION_RATE_LIMIT_EXCEEDED",
    "message": "Organization rate limit exceeded. Please retry after the specified duration.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "retry_after": 35,
      "reset_seconds": 35,
      "window_seconds": 60,
      "organization_id": "org-acme",
      "limit_type": "organization"
    }
  }
}
```

### Response Headers

```
HTTP/1.1 429 Too Many Requests
Retry-After: 35
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 35
X-RateLimit-LimitType: organization
```

### Distinguishing Characteristics

- Error code: `ORGANIZATION_RATE_LIMIT_EXCEEDED`
- `X-RateLimit-LimitType: organization` header present
- Details include `organization_id`
- Details include `limit_type: "organization"`
- Details do NOT include `endpoint`

---

## Comparison Table

| Aspect | Per-Key | Organization |
|--------|---------|--------------|
| **Error Code** | `RATE_LIMIT_EXCEEDED` | `ORGANIZATION_RATE_LIMIT_EXCEEDED` |
| **HTTP Status** | 429 | 429 |
| **X-RateLimit-LimitType** | (not set) | `organization` |
| **Details.organization_id** | ❌ absent | ✅ present |
| **Details.endpoint** | ✅ present | ❌ absent |
| **Details.limit_type** | ❌ absent | ✅ present (`"organization"`) |
| **Cause** | Single key exceeded | Organization shared budget exceeded |

---

## Client Implementation Examples

### JavaScript/TypeScript

```typescript
const response = await fetch('/v1/ai/inference', {
  method: 'POST',
  headers: { 'X-API-Key': 'key-acme-001' },
  body: JSON.stringify(payload)
});

if (response.status === 429) {
  const error = await response.json();
  
  if (error.error.code === 'RATE_LIMIT_EXCEEDED') {
    // Per-key rate limit exceeded
    console.log(`Your API key hit its limit. Retry after ${error.error.details.retry_after}s`);
  } else if (error.error.code === 'ORGANIZATION_RATE_LIMIT_EXCEEDED') {
    // Organization rate limit exceeded
    const org = error.error.details.organization_id;
    console.log(`Organization ${org} hit its limit. Retry after ${error.error.details.retry_after}s`);
  }
}
```

### Python

```python
import requests

response = requests.post(
    'https://api.example.com/v1/ai/inference',
    headers={'X-API-Key': 'key-acme-001'},
    json=payload
)

if response.status_code == 429:
    error = response.json()
    code = error['error']['code']
    
    if code == 'RATE_LIMIT_EXCEEDED':
        # Per-key rate limit exceeded
        retry_after = error['error']['details']['retry_after']
        print(f"API key limit exceeded. Retry after {retry_after}s")
    
    elif code == 'ORGANIZATION_RATE_LIMIT_EXCEEDED':
        # Organization rate limit exceeded
        org_id = error['error']['details']['organization_id']
        retry_after = error['error']['details']['retry_after']
        print(f"Org {org_id} limit exceeded. Retry after {retry_after}s")
```

### Using Header

```python
# Alternative: Check header instead of error code
if response.status_code == 429:
    limit_type = response.headers.get('X-RateLimit-LimitType', 'per-key')
    
    if limit_type == 'organization':
        print("Organization-level limit exceeded")
    else:
        print("API key-level limit exceeded")
```

---

## Recommended Client Handling

### Exponential Backoff

Both error types should trigger exponential backoff:

```python
import time
import random

def make_request_with_retry(api_key, payload, max_retries=5):
    for attempt in range(max_retries):
        response = requests.post(
            'https://api.example.com/v1/ai/inference',
            headers={'X-API-Key': api_key},
            json=payload
        )
        
        if response.status_code == 429:
            error = response.json()
            retry_after = int(error['error']['details']['retry_after'])
            
            # Add jitter to prevent thundering herd
            jitter = random.uniform(0, 0.1)
            wait_time = retry_after * (2 ** attempt) + jitter
            
            print(f"Rate limited. Waiting {wait_time:.1f}s before retry...")
            time.sleep(wait_time)
            continue
        
        return response
    
    raise Exception("Max retries exceeded")
```

### Distinguishing Behavior

For **per-key** limits, consider:
- Reducing request rate from this specific key
- Distributing load across multiple keys

For **organization** limits, consider:
- Reducing request rate across all organization keys
- Contacting operator to increase organization tier
- Distributing requests across different organizations

---

## Testing

See `tests/test_org_rate_limiter.py` for test cases demonstrating both error responses:

- `test_org_limit_exceeded_distinct_error`: Verifies organization error is returned
- `test_per_key_limit_enforced_independently`: Verifies per-key error is still enforced
- `test_org_error_response_headers`: Verifies response headers

---

## Acceptance Criteria Met

✅ **Distinct Error Response**: `ORGANIZATION_RATE_LIMIT_EXCEEDED` vs `RATE_LIMIT_EXCEEDED`

✅ **Documentable**: See `ORG_RATE_LIMIT_TIERS.md` for full documentation

✅ **Distinguishable by Header**: Check `X-RateLimit-LimitType` header

✅ **Distinguishable by Error Code**: Distinct error codes in response body

✅ **Distinguishable by Details**: Organization ID present only in org limit errors

---

## See Also

- `ORG_RATE_LIMIT_TIERS.md` - Full organization rate limit documentation
- `services/rate_limiter.py` - Per-key rate limiter implementation
- `services/org_rate_limiter.py` - Organization rate limiter implementation
- `tests/test_org_rate_limiter.py` - Comprehensive test coverage
- Issue #1200 - GitHub issue tracking this feature
