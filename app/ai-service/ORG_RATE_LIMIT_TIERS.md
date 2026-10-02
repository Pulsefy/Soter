# Per-Organization Rate Limit Tiers (Issue #1200)

## Overview

The AI Service now enforces **per-organization rate limits** in addition to per-key rate limits. This allows organizations holding multiple API keys to be subject to a shared rate limit ceiling, preventing an organization from circumventing per-key budgets by distributing requests across multiple keys.

### Key Concepts

- **Per-Key Rate Limits**: Each API key has an independent rate limit (existing behavior, preserved).
- **Per-Organization Rate Limits**: All API keys belonging to an organization share a single rate limit budget (new).
- **Enforcement**: Requests from any key belonging to an organization count against that organization's shared budget.
- **Isolation**: Different organizations have completely independent rate limit budgets.
- **Gradual Adoption**: Organizations without a configured tier bypass organization-level limiting entirely.

## Architecture

### Components

1. **`ApiKeyOrgMapping`** (`services/org_rate_limiter.py`)
   - Maps API keys to organization IDs
   - Thread-safe lookup with optional caching
   - Configuration at startup via `api_key_to_org_mapping` in settings

2. **`OrganizationRateLimiterService`** (`services/org_rate_limiter.py`)
   - Enforces organization-level sliding window rate limits
   - Supports both in-memory and Redis-backed distributed limiting
   - Thread-safe, production-ready

3. **Configuration** (`config.py`)
   - `org_rate_limit_tiers`: Map of organization IDs to tier strings (e.g., `"org-123": "100/minute"`)
   - `api_key_to_org_mapping`: Map of API keys to organization IDs (e.g., `"key-abc": "org-123"`)
   - `org_rate_limit_enabled`: Boolean to enable/disable organization-level limiting globally

4. **Middleware Integration** (`main.py`)
   - Organization rate limit check runs **after** per-key rate limit check
   - Added to `monitor_requests` middleware in request processing pipeline
   - If organization limit is exceeded, distinct error is returned immediately

5. **Metrics** (`metrics.py`)
   - `ORGANIZATION_RATE_LIMIT_EXCEEDED_TOTAL`: Counter for organization limit rejections
   - Separate from per-key rate limit metrics for visibility

## Configuration

### Environment Variables / Settings

```python
# Organization tier definitions (map of org_id -> rate_limit_string)
# Example:
# {
#   "org-acme": "100/minute",
#   "org-widgets": "50/minute",
#   "org-startup": "10/minute"
# }
ORG_RATE_LIMIT_TIERS = "{\"org-acme\": \"100/minute\"}"

# API key to organization mapping (map of api_key -> org_id)
# Example:
# {
#   "key-acme-001": "org-acme",
#   "key-acme-002": "org-acme",
#   "key-widgets-001": "org-widgets"
# }
API_KEY_TO_ORG_MAPPING = "{\"key-acme-001\": \"org-acme\"}"

# Global enable/disable for organization-level rate limiting
ORG_RATE_LIMIT_ENABLED = true
```

### At Startup

The application loads configuration during `lifespan()`:

```python
# In main.py lifespan()
if settings.org_rate_limit_tiers:
    for org_id, limit_str in settings.org_rate_limit_tiers.items():
        org_rate_limiter.set_organization_tier(org_id, limit_str)

if settings.api_key_to_org_mapping:
    api_key_org_mapping.set_batch_mapping(settings.api_key_to_org_mapping)
```

## Request Flow

```
HTTP Request
    ↓
Per-Key Rate Limit Check (existing)
    ├─ If key limit exceeded → 429 RATE_LIMIT_EXCEEDED
    └─ If passed
        ↓
Organization Rate Limit Check (new)
    ├─ If org not mapped → skip (bypass)
    ├─ If org has no tier → skip (bypass)
    ├─ If org limit exceeded → 429 ORGANIZATION_RATE_LIMIT_EXCEEDED
    └─ If passed
        ↓
Load Shedding Check (existing)
    └─ Process request
```

## Error Responses

### Per-Key Rate Limit Exceeded

**HTTP 429 Too Many Requests**

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

**Response Headers:**
```
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42
```

### Organization Rate Limit Exceeded

**HTTP 429 Too Many Requests** (distinct error code)

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

**Response Headers:**
```
Retry-After: 35
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 35
X-RateLimit-LimitType: organization
```

### Key Differences for Clients

Clients can distinguish between per-key and organization-level limiting by:

1. **Error Code**: `RATE_LIMIT_EXCEEDED` vs `ORGANIZATION_RATE_LIMIT_EXCEEDED`
2. **Response Header**: Check `X-RateLimit-LimitType` header (`"organization"` for org limits)
3. **Error Details**: Look for `organization_id` field in org limit errors

## Examples

### Example 1: Organization with Multiple Keys

**Setup:**
```python
# Configure organization tier
org_rate_limiter.set_organization_tier("org-acme", "100/minute")

# Map keys to organization
api_key_org_mapping.set_mapping("key-acme-001", "org-acme")
api_key_org_mapping.set_mapping("key-acme-002", "org-acme")
api_key_org_mapping.set_mapping("key-acme-003", "org-acme")
```

**Behavior:**
- All three keys share a 100-request/minute budget
- If key-001 makes 40 requests, key-002 can make 60 more
- If key-002 makes 30 requests, key-003 can make 30 more
- The 4th key attempting to use the remaining 0 requests will get a 429

**Request Sequence:**
```
1. key-acme-001: request 1-40 → 200 OK (org budget: 60/100 remaining)
2. key-acme-002: request 1-60 → 200 OK (org budget: 0/100 remaining)
3. key-acme-003: request 1   → 429 ORGANIZATION_RATE_LIMIT_EXCEEDED
```

### Example 2: Multiple Organizations with Independent Limits

**Setup:**
```python
# Configure two organizations
org_rate_limiter.set_organization_tier("org-acme", "100/minute")
org_rate_limiter.set_organization_tier("org-widgets", "50/minute")

# Map keys
api_key_org_mapping.set_mapping("key-acme", "org-acme")
api_key_org_mapping.set_mapping("key-widgets", "org-widgets")
```

**Behavior:**
- org-acme can make 100 requests/minute
- org-widgets can make 50 requests/minute
- Their limits are completely independent

### Example 3: Unmapped Keys Unaffected

**Setup:**
```python
org_rate_limiter.set_organization_tier("org-acme", "10/minute")
api_key_org_mapping.set_mapping("key-acme", "org-acme")
# key-unmapped is NOT mapped to any organization
```

**Behavior:**
- key-acme is subject to both per-key and org-level (10/min) limiting
- key-unmapped is only subject to per-key limiting (no org ceiling)
- This allows gradual rollout: map keys as organizations join the tier system

### Example 4: Organization without Tier

**Setup:**
```python
# org-startup is not in org_rate_limit_tiers
api_key_org_mapping.set_mapping("key-startup", "org-startup")
```

**Behavior:**
- key-startup is mapped to org-startup
- org-startup has no configured tier
- The check returns None (bypass), so only per-key limits apply
- This allows organizations to be added to mappings before tiers are configured

## Observability

### Metrics

- **`organization_rate_limit_exceeded_total`**: Counter incremented when an organization limit is exceeded
- Separate from per-key rate limit metrics for clear visibility

### Logs

Organization rate limit rejections are logged with:
```
event: "organization_rate_limit_exceeded"
organization_id: "org-acme"
api_key: "key-acme-001" (redacted)
limit: 100
remaining: 0
```

### Headers on Success

When an organization limit check passes, the request includes:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 25
```

(These headers are set by the middleware on successful requests.)

## Testing

See `tests/test_org_rate_limiter.py` for comprehensive test coverage:

- **ApiKeyOrgMapping tests**: Mapping operations, batch operations, clearing
- **OrganizationRateLimiterService tests**: Tier configuration, single/multiple keys, organization isolation
- **Integration tests**: End-to-end HTTP behavior, distinct error codes, multiple keys sharing budget, independent orgs

Run tests:
```bash
cd app/ai-service
pytest tests/test_org_rate_limiter.py -v
```

## Backward Compatibility

- **Existing per-key rate limits**: Unchanged behavior. All existing rate limit configurations and enforcement remain exactly as before.
- **Unmapped keys**: Keys not in `api_key_to_org_mapping` bypass organization limiting entirely. Only per-key limits apply.
- **Organizations without tiers**: Organizations not in `org_rate_limit_tiers` bypass limiting. Only per-key limits apply.
- **Disabled limiting**: Setting `ORG_RATE_LIMIT_ENABLED=false` disables all organization-level checking.

This design allows safe, gradual rollout:
1. Map keys to organizations (no tier configured yet → no change in behavior)
2. Configure tiers for organizations (enforcement begins)
3. Adjust tiers as needed

## Redis Support

Like per-key rate limiting, organization limiting supports both:

- **In-Memory**: Fast sliding window using thread-safe data structures (development, single-instance)
- **Redis**: Distributed sliding window using sorted sets (production, multi-instance)

Redis uses keys like: `ratelimit:org:<organization_id>`

## Implementation Details

### Sliding Window Algorithm

Both per-key and organization limiting use the same proven sliding window approach:

1. **Prune**: Remove timestamps older than the window
2. **Check**: Count remaining timestamps in window
3. **Enforce**: If count ≥ limit, reject with retry_after
4. **Record**: Append current timestamp and calculate remaining budget

Window size is configurable per tier (via `parse_rate_limit("X/unit")`).

### Thread Safety

- **In-memory**: Locks protect all accesses to `_in_memory_records`
- **Redis**: Pipeline-based operations ensure atomic checks

### Graceful Fallback

If Redis is unavailable:
- Per-key limiting falls back to in-memory
- Organization limiting falls back to in-memory
- No requests are dropped; fallback ensures service availability

## Future Enhancements

Potential future improvements:

1. **Persistent Storage**: Load mappings from database instead of config
2. **Dynamic Configuration**: Update tiers without restart
3. **Per-Endpoint Overrides**: Different org limits for different endpoints
4. **Usage Analytics**: Track per-org bandwidth usage for billing
5. **Burst Allowance**: Permit temporary bursts above the limit

## See Also

- `services/rate_limiter.py` - Per-key rate limiting implementation
- `services/org_rate_limiter.py` - Organization-level rate limiting
- `config.py` - Configuration schema
- `main.py` - Middleware integration
- `metrics.py` - Prometheus metrics
- Issue #1200 - GitHub issue tracking this feature
