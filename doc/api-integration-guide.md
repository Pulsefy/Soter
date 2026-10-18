# Frontend and Mobile API Integration Guide

This guide explains how a contributor should call the Soter backend from each
client — the **frontend** (Next.js) and the **mobile** app (Expo/React
Native) — including demo/mock behavior, the mobile request layer's
retry/backoff and offline conventions, and how the OpenAPI spec is meant to be
used as the source of truth for request/response shapes.

## Source of truth: the OpenAPI spec

Request and response shapes are defined by the backend's OpenAPI document, not
by hand-written types in each client:

- Backend spec: `app/backend/openapi/openapi.json` (generated; see
  `app/backend/src/swagger-config.ts` / `swagger-document.ts` and
  `tools/generate-openapi.cjs`).
- Once the spec is populated, prefer **generated types** over locally
  hand-maintained interfaces. Treat any client-side type that duplicates a
  backend shape as temporary until it can be replaced by generated types.

When a request or response shape is unclear, the OpenAPI document is the
authority — update it (backend) rather than diverging in a client.

## Frontend (Next.js)

The frontend calls the backend through a small client layer, with a mock layer
for demos and local development:

- **Real client:** `app/frontend/src/lib/api-client.ts` and the contract in
  `app/frontend/src/lib/api-contract.ts`.
- **Mock layer:** `app/frontend/src/lib/mock-api/`. This provides deterministic
  responses so the UI can run without a live backend (demos, CI, first-run
  local development).
- **Demo mode:** controlled at the client layer and surfaced to users by
  `app/frontend/src/components/DemoModeBanner.tsx` (and
  `mock-api/demo-mode-indicator.ts`). The intended pattern is:
  - Default to the **real client** when a backend base URL is configured.
  - Fall back to the **mock client** when the backend is not configured or
    demo mode is enabled, and show the demo-mode banner so it is never
    ambiguous whether data is live.

**Intended pattern for a new call:** add/confirm the endpoint in the OpenAPI
spec → call it through `api-client.ts` (never `fetch` directly in components) →
add a corresponding mock in `mock-api/` so demo mode keeps working.

## Mobile (Expo / React Native)

All mobile API calls route through a single request layer:

- **Request layer:** `app/mobile/src/services/requestLayer.ts` exposes
  `apiRequest`. Clients must use it instead of calling `fetch` directly, which
  guarantees consistent transient-failure recovery, observability, and timeout
  enforcement.
  - **Retry/backoff:** transient failures are retried with exponential backoff
    and jitter, up to `maxRetries` (default 3), bounded by a per-request
    `deadlineMs` (default 30 000 ms).
  - **Idempotency:** `POST`/`PUT`/`PATCH` are guarded by an idempotency key —
    an explicit `idempotencyKey`, or an auto-generated UUID v4 when omitted —
    so a retried write is not applied twice. `GET`/`DELETE` are treated as
    idempotent and are not key-guarded.
  - **Correlation:** each request sends `x-correlation-id` / `x-request-id`
    headers and stamps the id on every log line, so a request can be traced
    end to end.
- **Offline queueing:** writes made while offline are queued and replayed by
  `app/mobile/src/services/syncQueue.ts`. Each queued item carries its own
  correlation id, which is passed through `apiRequest` so the eventual send is
  traceable back to the queued action; combined with idempotency keys, replay
  is safe against duplicates. Read-side caching lives in
  `app/mobile/src/services/localCache.ts`.

**Intended pattern for a new call:** add/confirm the endpoint in the OpenAPI
spec → call it through `apiRequest` with the correct method (letting it manage
retries, deadline, and idempotency) → for writes that must survive being
offline, enqueue through `syncQueue` rather than calling `apiRequest` directly.

## Summary

- The OpenAPI spec (`app/backend/openapi/openapi.json`) is the source of truth;
  prefer generated types once it is populated.
- Frontend: go through `api-client.ts`; keep `mock-api/` in sync so demo mode
  works; the demo banner must reflect mock vs live data.
- Mobile: go through `apiRequest` (retry/backoff/idempotency/correlation);
  enqueue offline-capable writes through `syncQueue`.
