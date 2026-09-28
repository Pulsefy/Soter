# 0003 — Mock data / demo mode

- **Status:** Accepted
- **Date / context:** Recorded 2026-09-28 (Wave 9), documenting the mock-data
  and demo-mode approach used across the clients.

## Decision

Each client can run against deterministic mock data when a live backend is not
available, and this state is made visible to the user rather than hidden:

- Frontend: a mock API layer (`app/frontend/src/lib/mock-api/`) backs the real
  client (`app/frontend/src/lib/api-client.ts`), with a visible
  `DemoModeBanner` (`mock-api/demo-mode-indicator.ts`).
- Mobile: mock data lives in `app/mobile/src/services/mockData.ts`.

The intended rule is: use the real client when the backend is configured; fall
back to mock/demo data otherwise; and always surface demo mode in the UI so it
is never ambiguous whether data is live.

## Alternatives considered

- **No mock layer (require a running backend for any UI work).** Rejected: it
  blocks first-run local development, slows CI, and makes demos fragile.
- **Silent fallback to mock data with no indicator.** Rejected: users and
  reviewers could mistake demo data for live data, which is unacceptable for a
  humanitarian-aid product.

## Consequences

- The UI runs and is testable without a live backend.
- Demo mode is auditable and obvious on screen.
- Mock responses must be kept in step with the OpenAPI spec (see
  [`../api-integration-guide.md`](../api-integration-guide.md)) so the mock and
  real paths do not drift.
