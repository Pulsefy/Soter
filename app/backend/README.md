# Backend (NestJS API)

This module powers:

- Aid logic and APIs
- Verification APIs
- On-chain anchoring integrations

## Local development

From the repo root:

```bash
pnpm install
pnpm --filter backend run start:dev
```

By default the server listens on `PORT` (see `.env.example`).

## Environment

Create `app/backend/.env` from `app/backend/.env.example`:

```bash
cp app/backend/.env.example app/backend/.env
```

Then edit `.env` with your specific values. See [.env.example](.env.example) for detailed inline comments and local development defaults.

### Environment Variables

All environment variables are documented in [`.env.example`](.env.example) with inline comments, examples, and notes on when each is required.

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| **Server Configuration** |
| `PORT` | Port the NestJS server listens on | `3001` | No |
| `NODE_ENV` | Node environment (`development`, `production`, `test`) | `development` | No |
| **Database** |
| `DATABASE_URL` | PostgreSQL connection string for Prisma | `postgresql://postgres:postgres@localhost:5432/soter?schema=public` | Yes |
| **Blockchain (Stellar/Soroban)** |
| `STELLAR_RPC_URL` | Stellar RPC endpoint for Soroban interactions | `https://soroban-testnet.stellar.org` | Yes |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase (auto-detected if not set) | Auto-detected | No |
| `SOROBAN_CONTRACT_ID` | Deployed AidEscrow contract ID | None | No* |
| **AI & Verification** |
| `OPENAI_API_KEY` | OpenAI API key for server-side verification | Empty (disabled) | No** |
| `VERIFICATION_MODE` | Verification mode: `client-side` or `server-side` | `client-side` | No |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-3.5-turbo` | No |
| **CORS** |
| `CORS_ORIGINS` | Comma-separated allowed origins (defaults only in dev/test) | `http://localhost:3000,http://localhost:3001` | No |
| `CORS_ALLOW_CREDENTIALS` | Allow CORS credentials (cookies/authorization headers) | `false` | No |
| **Queue & Cache** |
| `REDIS_URL` | Redis connection URL for BullMQ | `redis://localhost:6379` | No*** |
| `QUEUE_ENABLED` | Enable background job queues | `false` | No |
| **Security** |
| `JWT_SECRET` | Secret for JWT token signing | Auto-generated | No |
| `JWT_EXPIRES_IN` | JWT token expiration time | `7d` | No |
| **Rate Limiting** |
| `API_RATE_LIMIT` | Max requests per minute per IP | `100` | No |
| `THROTTLE_TTL` | Rate limit window (milliseconds) | `60000` | No |
| `THROTTLE_ENABLED` | Enable request throttling | `true` | No |
| **Monitoring** |
| `METRICS_ENABLED` | Enable Prometheus metrics at `/metrics` | `false` | No |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `debug` | No |
| `SENTRY_DSN` | Sentry DSN for error tracking | None | No |
| **Feature Flags** |
| `SWAGGER_ENABLED` | Enable API docs at `/api/docs` | `true` | No |
| `API_VERSIONING_ENABLED` | Enable API versioning | `true` | No |

\* Required for blockchain interactions  
\*\* Required only if `VERIFICATION_MODE=server-side`  
\*\*\* Required only if `QUEUE_ENABLED=true`

### Configuration Modes

#### Local Development
The default `.env.example` values work out of the box for local development:
- Uses local PostgreSQL with default credentials
- Points to Stellar testnet
- Client-side verification (no OpenAI key needed)
- Queues disabled (no Redis needed)
- Full logging and Swagger enabled

#### Production
For production deployments, update these critical variables:
- `NODE_ENV=production`
- `DATABASE_URL` - Use secure credentials and connection pooling
- `STELLAR_RPC_URL` - Switch to mainnet if deploying live
- `JWT_SECRET` - Generate with `openssl rand -base64 32`
- `CORS_ORIGINS` - Set to your actual frontend domain(s)
- `METRICS_ENABLED=true` - Enable for monitoring
- `SWAGGER_ENABLED=false` - Disable public API docs
- `LOG_LEVEL=info` - Reduce log verbosity

### Troubleshooting

**Database connection fails:**
- Ensure PostgreSQL is running: `pg_isready`
- Verify credentials in `DATABASE_URL`
- Check database exists: `psql -l`

**Stellar RPC errors:**
- Verify network connectivity to RPC endpoint
- Check if using correct network (testnet vs mainnet)
- Ensure you have testnet XLM from [Stellar Laboratory](https://laboratory.stellar.org)

**OpenAI verification not working:**
- Verify `OPENAI_API_KEY` is set correctly
- Check API key has credits: https://platform.openai.com/usage
- Ensure `VERIFICATION_MODE=server-side`

**Queue/Redis errors:**
- Only relevant if `QUEUE_ENABLED=true`
- Ensure Redis is running: `redis-cli ping`
- Verify `REDIS_URL` connection string

## Database (Prisma)

Prisma schema lives in `prisma/schema.prisma`.

Run migrations:

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend prisma:migrate
```

## Routes

- `GET /health`

Example:

```bash
curl -s http://localhost:3001/health
```

## Scripts

Run from repo root:

```bash
pnpm --filter backend lint
pnpm --filter backend test
```

## Runbook

This section provides operational procedures for common tasks and incident response.

### Verification Inbox Management

**View pending verifications:**
```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3001/api/v1/verification-inbox?status=pending_review
```

**Approve a verification:**
```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nextStepMessage": "Verification approved. Proceed to disbursement."}' \
  http://localhost:3001/api/v1/verification-inbox/{id}/approve
```

**Reject a verification:**
```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rejectionReason": "Document appears fraudulent", "nextStepMessage": "Please resubmit with valid documentation"}' \
  http://localhost:3001/api/v1/verification-inbox/{id}/reject
```

**Request resubmission:**
```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rejectionReason": "Document expired", "nextStepMessage": "Please submit a current government-issued ID"}' \
  http://localhost:3001/api/v1/verification-inbox/{id}/request-resubmission
```

### Ledger Backfill

**Trigger a backfill for missing ledger ranges:**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startLedger": 1000, "endLedger": 2000, "batchSize": 100}' \
  http://localhost:3001/api/v1/admin/ledger/backfill
```

**Check backfill job status:**
```bash
curl -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  http://localhost:3001/api/v1/admin/ledger/backfill/{jobId}
```

**Notes:**
- Backfill is idempotent - can be run repeatedly without duplicating data
- Uses `batchSize` to control memory usage during processing
- Job status includes processed count and total count

### Ledger Reconciliation

**Trigger reconciliation to detect discrepancies:**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startLedger": 1000, "endLedger": 2000, "thresholdPercent": 5}' \
  http://localhost:3001/api/v1/admin/ledger/reconcile
```

**Check reconciliation report:**
```bash
curl -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  http://localhost:3001/api/v1/admin/ledger/reconcile/{jobId}
```

**Interpreting results:**
- `actionable: true` - High severity discrepancies or many medium severity issues
- Discrepancy types: `missing`, `amount_mismatch`, `count_mismatch`
- Severity levels: `low`, `medium`, `high`

### Monitoring and Observability

**View Prometheus metrics:**
```bash
curl http://localhost:3001/metrics
```

**Key metrics to monitor:**
- `http_requests_total` - Total HTTP requests by method, route, status code
- `http_request_duration_seconds` - Request latency distribution
- `error_rate_total` - Error count across all systems
- `ingestion_lag_seconds` - Time between event creation and processing
- `webhook_retries_total` - Webhook delivery retry count
- `jobs_processed_total` / `jobs_failed_total` - Background job success/failure rates
- `onchain_operations_total` - On-chain operation counts by status

**Structured logging fields:**
- `request_id` - Unique identifier for each request (from X-Request-ID header)
- `user_id` - User identifier from JWT token
- `route` - HTTP method and path (e.g., "GET /api/v1/health")
- `duration_ms` - Request processing time in milliseconds
- `correlationId` - Tracks async operations across services

### Incident Response

**High error rate detected:**
1. Check `error_rate_total` metrics breakdown by error type
2. Review logs for error patterns using `request_id` correlation
3. If on-chain failures: check Stellar RPC endpoint status
4. If webhook failures: verify external service availability

**Ingestion lag increasing:**
1. Monitor `ingestion_lag_seconds` gauge
2. Check queue depth: `curl http://localhost:3001/api/v1/jobs/status`
3. If lag > 60s: trigger backfill for affected ledger ranges
4. Run reconciliation to identify missing data

**Webhook delivery failures:**
1. Check `webhook_retries_total` by reason
2. Verify external service endpoints are accessible
3. Check authentication credentials for external services
4. Review webhook payload sizes (may exceed limits)

**Database performance issues:**
1. Monitor `db_query_duration_seconds` histogram
2. Check connection pool metrics
3. Run `EXPLAIN ANALYZE` on slow queries
4. Consider adding indexes for frequently queried fields

### Security Headers Verification

**Verify security headers are present:**
```bash
curl -I http://localhost:3001/api/v1/health
```

Expected headers in production:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` (with strict directives)
- `X-Permitted-Cross-Domain-Policies: none`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Verify CORS configuration:**
```bash
curl -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS http://localhost:3001/api/v1/health
```

Expected response headers:
- `Access-Control-Allow-Origin: https://yourdomain.com` (or configured origin)
- `Access-Control-Allow-Methods` (based on request)

## Contributing

See `app/backend/CONTRIBUTING.md`.
