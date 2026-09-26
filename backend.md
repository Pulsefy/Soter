# Backend Issues

## Wave 8

Wave 8 backend work focuses on retiring the mock/demo code paths that still sit in
production services, closing security gaps in real-time transports, and adding the
operational tooling the backend needs once testnet flows become contributor-facing.

---

## Issue 1: Replace Mock Package ID Generation in Claims Service With Real Onchain Package IDs
**Labels:** Backend, feature, onchain, integration, data-model
**Complexity:** Hard (200)

**Description**
`app/backend/src/claims/claims.service.ts` currently derives package identifiers with a
private `generateMockPackageId(claimId)` helper (see lines ~201, ~276 and ~438). This means a
claim's `packageId` is a deterministic fake string rather than the `u64` package id actually
created by the `aid_escrow` Soroban contract via `create_package`. Any downstream consumer that
tries to resolve a claim to a real onchain package will fail.

Wire the claim lifecycle to real package ids returned by the onchain adapter, and keep the
deterministic mock available only under the explicit mock adapter used in tests.

**Acceptance Criteria**
- Claims persist the real `u64` package id returned by the onchain adapter when a package is created
- `generateMockPackageId` is removed from the production path and lives only behind `MockOnchainAdapter`
- Existing claims are handled by a migration or a documented backfill path rather than silently breaking
- A claim can be resolved to its onchain package and verified against `get_package`
- Unit tests cover the real-adapter and mock-adapter paths separately

---

## Issue 2: Remove Hardcoded Campaign ID From Aid Service
**Labels:** Backend, bug, data-model, api
**Complexity:** Trivial (100)

**Description**
`app/backend/src/aid/aid.service.ts` line 18 assigns `const campaignId = 'mock-c-id';`. This
hardcoded literal means every aid record created through this path is attributed to a campaign
that does not exist, which corrupts campaign-level aggregates and makes the aid list untrustworthy.

Resolve the campaign from the request or the authenticated organization context instead.

**Acceptance Criteria**
- The hardcoded `'mock-c-id'` literal is removed
- Campaign id is resolved from the request payload or org context and validated to exist
- A clear validation error is returned when no valid campaign can be resolved
- A regression test asserts no hardcoded campaign id is used

---

## Issue 3: Replace Mock Evidence Upload With Real Object Storage Driver
**Labels:** Backend, feature, evidence, integration, infrastructure
**Complexity:** Hard (200)

**Description**
`app/backend/src/evidence/evidence.service.ts` around line 181 contains a
`// MOCK: Simulate upload to S3/Cloud Storage` block. Evidence is therefore never durably
stored, so evidence review, artifact access tokens, and the AI service's artifact fetch all
operate against a file that does not exist outside the request.

Introduce a real storage driver with a pluggable interface so contributors can run locally
against MinIO or the filesystem while deployments use S3-compatible storage.

**Acceptance Criteria**
- A `StorageDriver` interface exists with at least an S3-compatible and a local implementation
- The driver is selected by configuration, and configuration is validated at startup
- Uploaded evidence returns a real, retrievable storage key
- The mock path remains available for tests but is never selected by default
- Failure to store evidence produces a typed error rather than a silent success

---

## Issue 4: Implement Real Notification Delivery Providers
**Labels:** Backend, feature, integration, reliability, ops
**Complexity:** Hard (200)

**Description**
`app/backend/src/notifications/notifications.processor.ts` lines ~55-65 log
`[Mock] Sending ...` and return a fake `mock-msg-${Date.now()}` message id. No notification is
actually delivered, yet the `NotificationOutbox` model records the send as successful.

Add real delivery adapters and make the outbox reflect true delivery outcomes.

**Acceptance Criteria**
- At least one real email and one real SMS/push adapter exist behind a common interface
- Adapter selection and credentials come from validated configuration
- The outbox records provider message ids and real success/failure states
- Delivery failures are retried according to the existing outbox semantics
- Mock delivery remains selectable explicitly for local development

---

## Issue 5: Authenticate the Job Status WebSocket Gateway
**Labels:** Backend, security, auth, bug, reliability
**Complexity:** Medium (150)

**Description**
`app/backend/src/jobs/gateways/job-status.gateway.ts` line ~93 carries
`// TODO: Validate JWT token - implement based on your auth strategy`. The job status
WebSocket therefore accepts unauthenticated connections, letting any client subscribe to job
status streams for jobs belonging to other organizations.

Enforce authentication and per-organization authorization on connection and subscription.

**Acceptance Criteria**
- Connections without a valid token are rejected during the handshake
- A client may only subscribe to jobs belonging to its own organization
- Token expiry during a live connection terminates the socket
- Tests cover unauthenticated, wrong-org, and valid-subscription cases

---

## Issue 6: Add Prisma Migration Drift Detection to CI
**Labels:** Backend, ci, database, data-model, devex
**Complexity:** Medium (150)

**Description**
`app/backend/prisma/schema.prisma` defines well over forty models and enums, but
`app/backend/prisma/migrations` contains only seven migration directories. That gap means the
schema and the migration history have diverged, so a fresh database built from migrations will
not match the schema the code expects.

Add a CI check that fails when schema and migrations drift, and reconcile the current gap.

**Acceptance Criteria**
- CI runs a drift check (for example `prisma migrate diff`) and fails on divergence
- The existing drift is reconciled with a migration that brings migrations in line with the schema
- A fresh database created only from migrations passes the backend e2e suite
- The contributor workflow for adding migrations is documented

---

## Issue 7: Add Expiry and Garbage Collection for Idempotency Keys
**Labels:** Backend, reliability, database, performance, ops
**Complexity:** Medium (150)

**Description**
The `IdempotencyKey` model in `app/backend/prisma/schema.prisma` stores replay-protection
records, but there is no scheduled cleanup. The table grows without bound, which slowly degrades
lookup performance and inflates backup size.

Add a retention window and a scheduled purge consistent with the existing retention policy machinery.

**Acceptance Criteria**
- Idempotency records carry an explicit expiry
- A scheduled job purges expired records in bounded batches
- The retention window is configurable
- Purge activity emits a metric and a structured log line
- Expired-but-not-yet-purged keys are treated as absent

---

## Issue 8: Add Dead-Letter Handling for the Notification Outbox
**Labels:** Backend, reliability, ops, observability, integration
**Complexity:** Medium (150)

**Description**
`NotificationOutbox` has status states but no terminal dead-letter path with operator tooling.
When a notification exhausts its retries there is no supported way to inspect, replay, or
discard it, so failures become invisible.

The AI service already gained dead-letter replay in Wave 7 (`app/ai-service/services/dead_letter.py`);
bring the backend outbox to parity.

**Acceptance Criteria**
- Exhausted notifications move to an explicit dead-letter state with a stored failure reason
- An admin-only endpoint lists dead-lettered notifications with pagination
- Individual and bulk replay are supported and are idempotent
- Dead-letter depth is exposed as a metric
- Replay attempts are recorded in the audit log

---

## Issue 9: Enforce API Key Expiry and Support Rotation
**Labels:** Backend, security, auth, api, admin
**Complexity:** Medium (150)

**Description**
The `ApiKey` model and the scope guard in `app/backend/src/api-keys/` gate access by scope, but
there is no supported rotation flow and no enforced expiry. Long-lived keys cannot be rotated
without downtime, which pushes operators toward sharing keys.

Add expiry enforcement and an overlap-window rotation flow.

**Acceptance Criteria**
- Keys carry an optional expiry that is enforced on every request
- A rotation endpoint issues a successor key while the predecessor stays valid for a grace window
- Expired and revoked keys produce distinguishable error responses
- Rotation and revocation are written to the audit log
- Tests cover expiry, rotation overlap, and post-grace rejection

---

## Issue 10: Execute Retention Policies on a Schedule
**Labels:** Backend, ops, privacy, database, feature
**Complexity:** Hard (200)

**Description**
`app/backend/src/retention-policy/` and the `RetentionPolicy` model with its `PurgeStrategy`
enum describe how data should be aged out, but nothing runs the policies on a schedule. Retention
is therefore declarative only, which is a privacy problem for evidence and verification data.

Add a scheduled executor that applies policies safely and observably.

**Acceptance Criteria**
- A scheduler applies due retention policies in bounded batches
- Each strategy in `PurgeStrategy` is implemented and covered by tests
- A dry-run mode reports what would be purged without mutating data
- Purge runs are auditable, including counts per entity type
- Failures are retried without double-purging

---

## Issue 11: Detect and Alert on Stuck Soroban Transactions
**Labels:** Backend, observability, reliability, onchain, ops
**Complexity:** Medium (150)

**Description**
`app/backend/src/onchain/soroban-transaction-lifecycle.service.ts` and the
`SorobanTransaction` model track transaction state, but nothing flags transactions that sit in a
non-terminal state past a reasonable ledger window. Stuck submissions are only noticed manually.

Add detection, metrics, and an operator escalation path.

**Acceptance Criteria**
- Transactions exceeding a configurable age in a non-terminal state are flagged
- Stuck counts are exposed per operation type as metrics
- An admin endpoint lists stuck transactions with their last known state
- Detection distinguishes retryable errors (see `RetryableErrorType`) from terminal ones
- Tests cover the stuck, recovered, and terminal transitions

---

## Issue 12: Add a Review Queue for Low-Confidence Entity Links
**Labels:** Backend, feature, data-model, workflow, admin
**Complexity:** Hard (200)

**Description**
`app/backend/src/entity-linking/` and the `EntityLink` model link imported records to registry
entities, but there is no human review path for uncertain matches. Low-confidence links are
either silently accepted or silently dropped, both of which corrupt registry data.

Add explicit confidence banding and a reviewable queue.

**Acceptance Criteria**
- Links carry a confidence score and a banding threshold from configuration
- Links below the threshold enter a review queue instead of being auto-applied
- Reviewers can accept, reject, or remap a queued link
- Review decisions are audited and can feed back into scoring
- Queue depth and decision latency are exposed as metrics

---

## Issue 13: Support Resume and Progress Streaming for Import Jobs
**Labels:** Backend, feature, reliability, workflow, api
**Complexity:** Hard (200)

**Description**
`app/backend/src/recipient-import/` and the `ImportJob` model with `ImportJobStatus` drive
recipient imports, but a job interrupted mid-run cannot resume, and clients cannot observe
progress except by polling for terminal status. Large imports are therefore fragile and opaque.

**Acceptance Criteria**
- Import jobs checkpoint progress and can resume from the last checkpoint after a restart
- Resuming never double-applies previously imported rows
- Progress (processed/total, error count) is observable while the job runs
- Cancellation stops work promptly and leaves a consistent state
- Tests cover interrupt-and-resume and cancellation

---

## Issue 14: Make the Audit Log Tamper-Evident
**Labels:** Backend, security, audit, data-model, governance
**Complexity:** Hard (200)

**Description**
The `AuditLog` model records security-relevant actions, but entries are ordinary mutable rows.
An actor with database access can alter or delete history without detection, which undercuts the
audit trail's purpose for a humanitarian aid system.

Add tamper evidence via a hash chain over audit entries.

**Acceptance Criteria**
- Each audit entry stores a hash covering its content and the previous entry's hash
- A verification routine detects insertion, mutation, and deletion
- An admin endpoint reports chain integrity status
- Chain verification is covered by tests including deliberate tampering
- The scheme is documented, including its limits

---

## Issue 15: Apply Rate Limiting Per API Key and Scope
**Labels:** Backend, security, performance, api, reliability
**Complexity:** Medium (150)

**Description**
API keys carry scopes (`app/backend/src/api-keys/api-key-scope.enum.ts`) but there is no
per-key rate limiting, so one integration can exhaust shared capacity and degrade the service for
everyone. The AI service already has a load shedder; the backend has no equivalent admission control.

**Acceptance Criteria**
- Limits are enforced per API key with configurable per-scope overrides
- Exceeded limits return `429` with standard rate-limit headers
- Limit state is shared across instances via Redis
- Limits and rejections are exposed as metrics
- Tests cover per-key isolation and header correctness

---

## Issue 16: Deepen Health Checks to Cover Real Dependencies
**Labels:** Backend, observability, reliability, ops, integration
**Complexity:** Medium (150)

**Description**
`app/backend/src/health/` reports service health, but it does not meaningfully distinguish a
healthy process from one that cannot reach Postgres, Redis, the AI service, or a Soroban RPC
endpoint. Orchestrators therefore keep routing traffic to instances that cannot serve requests.

**Acceptance Criteria**
- Liveness and readiness are separate endpoints with distinct semantics
- Readiness checks Postgres, Redis, the AI service, and Soroban RPC with per-dependency timeouts
- Each dependency reports status and latency individually
- A degraded-but-serving state is distinguishable from a hard failure
- Checks are cached briefly so probes cannot become a load source

---

## Issue 17: Expose Evidence Queue SLA Metrics
**Labels:** Backend, observability, metrics, evidence, analytics
**Complexity:** Trivial (100)

**Description**
`EvidenceQueueItem` and `EvidenceStatus` model the evidence review pipeline, but there are no
metrics describing how long items wait or how the backlog is trending. Operators cannot tell
whether evidence review is keeping up with intake.

**Acceptance Criteria**
- Queue depth is exposed per `EvidenceStatus`
- Age of the oldest pending item is exposed
- Time from intake to decision is recorded as a histogram
- Metrics carry bounded label cardinality
- The metrics are documented alongside the existing observability docs

---

## Issue 18: Add Safe Search Index Rebuild Tooling
**Labels:** Backend, ops, tooling, reliability, admin
**Complexity:** Medium (150)

**Description**
`app/backend/src/search/` serves search over backend entities, but there is no supported way to
rebuild the index after a schema change or a bad partial write. Recovery currently means manual
intervention with no progress visibility or resumability.

**Acceptance Criteria**
- An admin-triggered rebuild runs in bounded batches without blocking live search
- Rebuild progress is observable and the operation is resumable
- A dry run reports document counts without mutating the index
- Concurrent rebuild requests are rejected rather than interleaved
- The runbook for rebuilds is documented

---

## Issue 19: Publish a Canonical API Error Code Catalog
**Labels:** Backend, api, devex, architecture, integration
**Complexity:** Medium (150)

**Description**
Error responses across the backend are shaped inconsistently, so frontend and mobile clients
match on messages and HTTP status alone. That makes client error handling brittle and blocks
precise, localizable error messaging.

Introduce stable machine-readable error codes and apply them through a shared exception filter.

**Acceptance Criteria**
- A single enumerated catalog of error codes exists with stable string identifiers
- A global exception filter emits `{ code, message, details?, traceId }` consistently
- Existing thrown errors are migrated to catalog codes
- Codes are covered by tests asserting response shape
- The catalog is exported for client consumption

---

## Issue 20: Generate and Publish the Backend OpenAPI Specification
**Labels:** Backend, api, devex, documentation, tooling
**Complexity:** Medium (150)

**Description**
The backend exposes a large surface across claims, campaigns, evidence, verification, onchain,
and admin modules, but there is no generated machine-readable specification. Contributors working
on the frontend or mobile app must read controllers to learn request and response shapes.

**Acceptance Criteria**
- An OpenAPI document is generated from the existing decorators and DTOs
- The spec is served at a documented endpoint and written to a checked-in artifact
- CI fails when the committed spec drifts from the generated one
- Auth schemes, including API key scopes, are represented
- The spec validates against an OpenAPI linter

---
