# Prisma: VerificationSession

This folder contains the Prisma schema and migrations used by the backend.

Key artifact for verification persistence

- Model: `VerificationSession` (defined in `schema.prisma`)
  - id: String (cuid)
  - channel: VerificationChannel (email | phone)
  - identifier: String (email or phone)
  - code: String (OTP)
  - attempts: Int
  - resendCount: Int
  - status: VerificationSessionStatus (pending | completed | expired)
  - expiresAt: DateTime
  - createdAt, updatedAt

- Migration: `20260219221806_add_verification_session`

Running locally

1. Generate Prisma client (this is run automatically on install via `postinstall`):

```bash
pnpm --filter backend prisma:generate
```

2. Apply migrations (development):

```bash
pnpm --filter backend prisma:migrate
```

3. Seed demo data for local testing:

```bash
pnpm --filter backend prisma:seed
```

This creates:
- 3 roles (admin, ngo, user)
- 4 development API keys for testing different app roles
- 2 demo campaigns (Emergency Relief Fund and Community Health Program)
- 4 demo claims (2 per campaign with different statuses)

Perfect for local testing and e2e runs without manual setup.

Notes for tests

- The backend includes e2e tests that exercise the verification flow and verify
  that sessions are created, updated and queried via the Prisma client
  (`test/verification-flow.e2e-spec.ts`). If the `VerificationSession` table is
  missing the tests will error with a suggestion to run the migrations.
