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

## Running E2E Tests

The backend includes a comprehensive End-to-End (E2E) test suite that validates critical user and system flows over real HTTP boundaries.

### Prerequisites

Ensure you have the test environment configured:

```bash
# Copy test environment configuration
cp app/backend/.env.test app/backend/.env.test
# The test environment uses CI-safe settings and mocks
```

### Running Tests

```bash
# Run all E2E tests
pnpm --filter backend test:e2e

# Run with coverage
pnpm --filter backend test:e2e -- --coverage

# Run specific test file
pnpm --filter backend test:e2e -- health.e2e-spec.ts

# Run with verbose output
pnpm --filter backend test:e2e -- --verbose
```

### Test Coverage

The E2E test suite covers:

- **Health & Readiness**: Tests `/health`, `/health/live`, and `/health/ready` endpoints
- **Verification Flow**: Complete user verification lifecycle (start → complete → verify state)
- **Soroban Proxy**: On-chain operations with mocked blockchain client
- **Authentication & Authorization**: API key and JWT token validation
- **Error Handling**: Proper HTTP status codes and error responses
- **Database Side Effects**: Data persistence and state transitions

### Test Architecture

- **Framework**: NestJS Testing utilities with Jest
- **HTTP Client**: Supertest for real HTTP requests
- **Database**: In-memory SQLite for testing
- **Blockchain**: Mocked Soroban adapter (no real network calls)
- **Configuration**: CI-safe with `.env.test`

### Test Files

- `test/e2e/health.e2e-spec.ts` - Health endpoint tests
- `test/e2e/verification-flow.e2e-spec.ts` - Verification lifecycle tests
- `test/e2e/soroban-proxy.e2e-spec.ts` - On-chain operation tests
- `test/utils/test-app.ts` - Test bootstrap utilities
- `test/utils/factories.ts` - Test data factories

### CI/CD Integration

The E2E tests are designed to run in CI/CD pipelines with:
- Zero secrets required
- Mocked external dependencies
- Deterministic test data
- Parallel execution support

## Contributing

See `app/backend/CONTRIBUTING.md`.
