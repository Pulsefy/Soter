# Cost-Aware Rate Limiting per Endpoint

## Overview

This document describes the cost-aware rate limiting system implemented for the Soter API. The system enforces per-endpoint rate limits based on the computational cost and resource usage of each operation.

## Architecture

### Components

1. **Rate Limit Decorator** (`@RateLimit`)
   - Decorator to configure rate limits per endpoint
   - Supports custom limits, windows, and cost weights
   - Applied directly to controller methods

2. **Cost-Aware Rate Limit Guard** (`CostAwareRateLimitGuard`)
   - Guard that enforces rate limits based on endpoint configuration
   - Uses Redis for distributed rate limiting
   - Automatically calculates costs based on HTTP method and path
   - Sets rate limit headers in responses

3. **Default Cost Categories**
   - **Read operations (GET)**: Cost = 1
   - **Write operations (POST/PUT/PATCH)**: Cost = 5
   - **Expensive operations (on-chain)**: Cost = 20
   - **Bulk operations**: Cost = 50

## Configuration

### Default Limits by User Type

```typescript
{
  public: { limit: 10, window: 60 },      // 10 requests per minute
  authenticated: { limit: 100, window: 60 }, // 100 requests per minute
  apiKey: { limit: 1000, window: 60 }      // 1000 requests per minute
}
```

### Using the Decorator

```typescript
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { UseGuards } from '@nestjs/common';
import { CostAwareRateLimitGuard } from 'src/common/guards/cost-aware-rate-limit.guard';

@Post(':id/disburse')
@UseGuards(CostAwareRateLimitGuard)
@RateLimit({ limit: 10, window: 60, cost: 20 })
async disburse(@Param('id') id: string) {
  // Expensive on-chain operation
}
```

### Decorator Options

```typescript
interface RateLimitConfig {
  limit: number;              // Maximum requests allowed
  window: number;             // Time window in seconds
  cost?: number;              // Cost weight (default: 1)
  skipSuccessfulRequests?: boolean; // Don't count successful requests
}
```

## Applied Rate Limits

### Claims Controller

- **POST /claims** - Create claim
  - Limit: 50 requests/minute
  - Cost: 5 (write operation)
  - User type: Authenticated (operator/admin)

- **POST /claims/:id/disburse** - Disburse funds
  - Limit: 10 requests/minute
  - Cost: 20 (expensive on-chain operation)
  - User type: Admin only

### Verification Controller

- **POST /verification/claims/:id/enqueue** - Enqueue verification
  - Limit: 30 requests/minute
  - Cost: 5 (write operation)
  - User type: API key

## Response Headers

All rate-limited endpoints include the following headers:

```
RateLimit-Limit: 100        # Maximum requests allowed
RateLimit-Remaining: 95     # Remaining requests
RateLimit-Reset: 45          # Seconds until reset
RateLimit-Cost: 5           # Cost of this request
RateLimit-Window: 60         # Time window in seconds
```

## Automatic Cost Calculation

If no decorator is applied, the guard automatically calculates costs based on:

1. **HTTP Method**
   - GET: Cost = 1
   - POST/PUT/PATCH: Cost = 5
   - DELETE: Cost = 5

2. **Path Patterns**
   - `/disburse`, `/onchain`: Cost = 20 (expensive)
   - `/bulk`, `/batch`: Cost = 50 (bulk operations)

## Rate Limit Exceeded Response

When a rate limit is exceeded, the API returns:

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded",
  "limit": 10,
  "remaining": 0,
  "resetIn": 45,
  "cost": 20
}
```

## Redis Key Structure

Rate limit keys are stored in Redis with the following format:

```
ratelimit:{userType}:{endpoint}:{identifier}
```

Example:
```
ratelimit:authenticated:post:/claims/:id/disburse:user_123
ratelimit:apiKey:post:/verification/claims/:id/enqueue:api_key_456
ratelimit:public:get:/claims/:anonymous_ip
```

## Configuration via Environment Variables

The system respects the following environment variables:

```bash
# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Default rate limits (fallback)
API_RATE_LIMIT=100
THROTTLE_TTL=60000
```

## Monitoring and Metrics

The rate limiting system logs:
- Rate limit violations
- Current usage statistics
- Endpoint-specific costs

To monitor rate limiting:
- Check Redis for current rate limit keys
- Monitor response headers for rate limit information
- Review logs for rate limit violations

## Best Practices

1. **Apply to Expensive Operations**
   - Always rate limit on-chain operations
   - Rate limit bulk operations
   - Rate limit resource-intensive computations

2. **Choose Appropriate Costs**
   - Read operations: Cost 1-5
   - Write operations: Cost 5-10
   - Expensive operations: Cost 20-50
   - Bulk operations: Cost 50+

3. **Set Reasonable Limits**
   - Public endpoints: 10-100 requests/minute
   - Authenticated: 100-1000 requests/minute
   - API keys: 1000+ requests/minute

4. **Monitor Usage**
   - Track rate limit violations
   - Adjust limits based on actual usage patterns
   - Consider implementing tiered rate limits

## Troubleshooting

### Rate Limits Too Strict

If users are hitting rate limits too frequently:
1. Review the cost assigned to the endpoint
2. Increase the limit for the user type
3. Consider implementing tiered rate limits based on user tier

### Rate Limits Not Working

If rate limits are not being enforced:
1. Verify Redis is running and accessible
2. Check that the guard is applied to the endpoint
3. Verify the decorator configuration
4. Check logs for errors

### Headers Not Appearing

If rate limit headers are missing:
1. Verify the guard is being executed
2. Check for other middleware that might remove headers
3. Review the response object structure

## Future Enhancements

1. **Tiered Rate Limits**
   - Implement different limits based on user subscription tier
   - Allow users to purchase higher rate limits

2. **Dynamic Cost Adjustment**
   - Adjust costs based on system load
   - Implement circuit breakers for overloaded endpoints

3. **Burst Allowance**
   - Allow temporary bursts above normal limits
   - Implement token bucket algorithm

4. **Rate Limit Analytics**
   - Dashboard for monitoring rate limit usage
   - Alerts for unusual patterns
   - Historical analysis of rate limit violations

## Security Considerations

- Rate limits are enforced per identifier (user ID, API key, or IP)
- Redis keys include user type to prevent privilege escalation
- Rate limit headers are informational only (do not rely on them for enforcement)
- Consider implementing IP-based rate limiting for public endpoints as additional protection

---

**Implementation Date:** 2026-05-29  
**Version:** 1.0  
**Author:** Cascade AI Assistant
