# Verification Module

## Overview
The Verification module provides async claim verification using BullMQ queues with configurable mock/AI modes.

## Features
-  BullMQ-based async job processing
-  Configurable mock/AI verification modes
-  Non-blocking enqueue endpoint
-  Queue metrics and monitoring
-  Retry logic with exponential backoff
-  Comprehensive lifecycle logging
-  Full test coverage (19 tests)

## Architecture

```
Client Request
     ↓
Controller (POST /verification/claims/:id/enqueue)
     ↓
Service.enqueueVerification()
     ↓
BullMQ Queue (Redis)
     ↓
Worker (VerificationProcessor)
     ↓
Service.processVerification()
     ↓
Database Update (Prisma)
```

## OTP / Identity Verification Flow

Soter supports an OTP-based verification flow (email or phone) with rate limiting.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/verification/start` | Start a verification session; sends OTP to email or phone |
| POST | `/api/v1/verification/resend` | Resend OTP for an existing session |
| POST | `/api/v1/verification/complete` | Submit OTP to complete verification |

### Flow

1. **Start**: `POST /verification/start` with `{ "channel": "email", "email": "user@example.com" }` or `{ "channel": "phone", "phone": "+15551234567" }`. Returns `sessionId` and `expiresAt`. Rate-limited per identifier (e.g. max 5 starts per email/phone per hour).
2. **Resend** (optional): `POST /verification/resend` with `{ "sessionId": "<id>" }`. Limited resends per session (default 3).
3. **Complete**: `POST /verification/complete` with `{ "sessionId": "<id>", "code": "123456" }`. Limited wrong-code attempts per session (default 5).

### Configuration (.env)

- `VERIFICATION_OTP_LENGTH` – OTP length in digits (default: 6)
- `VERIFICATION_OTP_TTL_MINUTES` – OTP validity in minutes (default: 10)
- `VERIFICATION_MAX_STARTS_PER_IDENTIFIER_PER_HOUR` – Start rate limit (default: 5)
- `VERIFICATION_MAX_RESENDS_PER_SESSION` – Max resends per session (default: 3)
- `VERIFICATION_MAX_ATTEMPTS_PER_SESSION` – Max wrong-code attempts (default: 5)

### Persistence

Sessions are stored in the `VerificationSession` table (Prisma). Run migrations so the table exists:

```bash
npx prisma migrate dev
```

E2E tests for this flow require the database to be migrated and (for full app) Redis for the claim-verification queue.

---

## API Endpoints (Claim verification)

### Enqueue Verification
```http
POST /v1/verification/claims/:id/enqueue
```

**Response (202 Accepted):**
```json
{
  "jobId": "1",
  "claimId": "clv789xyz123",
  "status": "queued",
  "message": "Verification job enqueued successfully"
}
```

### Get Queue Metrics
```http
GET /v1/verification/metrics
```

**Response (200 OK):**
```json
{
  "waiting": 5,
  "active": 2,
  "completed": 150,
  "failed": 3,
  "total": 160
}
```

### Get Claim Status
```http
GET /v1/verification/claims/:id
```

**Response (200 OK):**
```json
{
  "id": "clv789xyz123",
  "status": "verified",
  "verificationScore": 0.85,
  "verificationResult": {
    "score": 0.85,
    "confidence": 0.92,
    "details": {
      "factors": ["Document authenticity verified"],
      "riskLevel": "low"
    },
    "processedAt": "2026-01-25T00:00:00.000Z"
  },
  "verifiedAt": "2026-01-25T00:00:00.000Z"
}
```

## Configuration

### Environment Variables

```bash
# Verification mode: "mock" (default) or "ai"
VERIFICATION_MODE=mock

# Score threshold for auto-approval (0-1)
VERIFICATION_THRESHOLD=0.7

# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue configuration
QUEUE_ENABLED=true
QUEUE_CONCURRENCY=5
QUEUE_MAX_RETRIES=3
```

## Mock Verification

Mock mode generates realistic verification results:

- **Score**: 0.5 - 0.95 (random)
- **Confidence**: 0.85 - 0.95 (random)
- **Risk Level**: low/medium/high (based on score)
- **Factors**: 2-4 random verification factors
- **Recommendations**: Added for medium/high risk

## Usage Example

```typescript
// Enqueue verification
const result = await verificationService.enqueueVerification('claim-id');
console.log(result.jobId); // "1"

// Get metrics
const metrics = await verificationService.getQueueMetrics();
console.log(metrics.completed); // 150

// Get claim status
const claim = await verificationService.findOne('claim-id');
console.log(claim.status); // "verified"
console.log(claim.verificationScore); // 0.85
```

## Testing

```bash
# Run verification tests
npm test -- --testPathPatterns=verification

# Run with coverage
npm test -- --coverage --testPathPatterns=verification
```

## Future Enhancements

- [ ] Implement AI verification mode
- [ ] Add webhook notifications
- [ ] Add authentication guards
- [ ] Add Bull Board dashboard
- [ ] Add job priority levels
- [ ] Add batch verification
- [ ] Add verification history tracking

## Troubleshooting

### Redis Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Solution**: Start Redis server
```bash
docker run -d -p 6379:6379 redis:alpine
```

### Job Stuck in Waiting
**Solution**: Check worker is running and Redis is accessible

### High Failed Job Count
**Solution**: Check logs for error patterns, adjust retry configuration

## Monitoring

Monitor queue health using:
- GET /v1/verification/metrics endpoint
- Redis CLI: `redis-cli LLEN bull:verification:waiting`
- Bull Board (optional): Install `@bull-board/nestjs`

## Performance

- **Throughput**: ~100 jobs/second (depends on verification logic)
- **Latency**: <50ms enqueue, 100-500ms processing (mock mode)
- **Concurrency**: Configurable (default: 5)
- **Scaling**: Horizontal (add more worker instances)
