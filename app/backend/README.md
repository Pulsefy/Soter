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

## Contributing

See `app/backend/CONTRIBUTING.md`.
