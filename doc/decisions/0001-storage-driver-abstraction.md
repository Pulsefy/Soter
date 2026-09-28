# 0001 — Evidence storage driver abstraction

- **Status:** Accepted
- **Date / context:** Recorded 2026-09-28 (Wave 9), documenting a decision made
  in earlier waves as the evidence-storage code took shape.

## Decision

Evidence storage is accessed through a single driver interface
(`app/backend/src/evidence/storage/storage-driver.interface.ts`) with
interchangeable implementations — `local-storage.driver.ts`,
`s3-storage.driver.ts`, and `mock-storage.driver.ts` — selected by
configuration. Application code depends on the interface, never on a concrete
backend.

## Alternatives considered

- **Call the cloud SDK (e.g. S3) directly from services.** Rejected: it couples
  business logic to one provider, makes local development and tests require
  cloud credentials, and makes swapping providers a large change.
- **Local filesystem only.** Rejected: fine for development but not for
  deployment, and it would still leak storage details into services.

## Consequences

- Local development and CI use the local or mock driver with no cloud
  dependency; deployments use S3.
- Adding a new backend means implementing one interface, not touching callers.
- The driver boundary is the natural seam for storage-related tests.
