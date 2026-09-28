# Search Index Rebuild Runbook

## Overview

Soter's admin search is backed by a materialized search index (`searchIndexEntry`)
built from campaigns, claims, recipients, and verifications. The index is rebuilt
on demand by an admin-triggered rebuild job. This runbook covers how to run,
monitor, resume, and recover index rebuilds safely in testnet and production.

The rebuild is designed to be **safe**:

- Work is processed in **bounded batches** (keyset pagination) instead of one
  massive query, so live search keeps serving during the rebuild.
- **Progress is persisted** to a `searchIndexEntryBuild` row after every batch and
  is **resumable** if the process is interrupted.
- **Concurrent rebuilds are rejected** (HTTP 409) both within a single process and
  across backend replicas using a Postgres advisory lock.
- **Dry runs** report document counts **without mutating** the index.
- Reads fall back to legacy live queries whenever the index for an org is empty,
  and rebuilt entity types are purged of stale entries when a rebuild completes.

## Prerequisites

- A Postgres database reachable from the backend (advisory lock requires Postgres).
- An admin API key with the `admin` role. See
  [Admin Key Policy for Testnet Deployments](admin-key-policy-testnet.md).
- Backend API base URL, e.g. `https://api.example.com/api/v1` (or `http://localhost:3000/api/v1` locally).

## Configuration

| Setting | Meaning | Default |
| --- | --- | --- |
| `batchSize` | Documents processed per bounded batch | 100 |
| min batch / max batch | Allowed batch size range | 10 / 1000 |
| stale threshold | A running build with no heartbeat for this long is considered abandoned | 5 minutes |
| advisory lock key | Fixed Postgres lock used to serialize rebuild claims across instances | `955_355_955` |
| `SKIP_BACKGROUND_JOBS=true` | Stops the backend from auto-resuming stale builds on boot (used by spec/e2e tooling only) | unset |

## Endpoints

All endpoints require an admin API key (`Authorization: Bearer <api-key>`).

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/admin/search-index/rebuild` | Start a rebuild (or dry run) |
| `GET` | `/api/v1/admin/search-index/rebuild` | Latest rebuild run's progress |
| `GET` | `/api/v1/admin/search-index/rebuild/:id` | Progress for a specific build |

### Request body (`POST /admin/search-index/rebuild`)

| Field | Type | Description |
| --- | --- | --- |
| `dryRun` | `boolean` | Report per-entity counts without mutating the index (default `false`) |
| `resume` | `boolean` | Continue an interrupted (stale) build from its checkpoint (default `false`) |
| `batchSize` | `integer` | Documents per batch, 10–1000 (default 100) |
| `entityTypes` | `array<enum>` | Subset of `campaign, claim, recipient, verification` to rebuild (default: all) |

### Response (`RebuildProgress`)

```json
{
  "id": "build-123",
  "status": "running",
  "mode": "rebuild",
  "entityTypes": ["campaign", "claim", "recipient", "verification"],
  "batchSize": 100,
  "triggeredBy": "admin-api-key-id",
  "totalDocuments": 1250,
  "processedDocuments": 300,
  "percent": 24,
  "checkpoint": { "campaign": { "cursor": "c900", "done": false }, "claim": { "cursor": null, "done": false } },
  "statistics": { "campaign": { "found": 1200, "indexed": 300 } },
  "error": null,
  "startedAt": "2026-09-24T12:00:00.000Z",
  "completedAt": null,
  "updatedAt": "2026-09-24T12:05:00.000Z",
  "heartbeatAt": "2026-09-24T12:05:00.000Z"
}
```

`status` is one of `running`, `completed`, `failed`.

## Run a rebuild

### Standard rebuild

```bash
curl -X POST "https://api.example.com/api/v1/admin/search-index/rebuild" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Batched speed control

Lower `batchSize` to reduce peak load (minimum 10), raise it to finish faster
(maximum 1000):

```bash
curl -X POST "https://api.example.com/api/v1/admin/search-index/rebuild" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 50}'
```

### Rebuild a subset of entity types

```bash
curl -X POST "https://api.example.com/api/v1/admin/search-index/rebuild" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entityTypes": ["campaign", "recipient"]}'
```

### Dry run (counts only, no mutation)

```bash
curl -X POST "https://api.example.com/api/v1/admin/search-index/rebuild" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

A dry run reports per-entity document counts via `statistics` (and `totalDocuments`)
and immediately marks the build `completed` without writing index entries or
purging stale ones.

## Monitor progress

Poll the latest build:

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://api.example.com/api/v1/admin/search-index/rebuild"
```

Poll a specific build:

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  "https://api.example.com/api/v1/admin/search-index/rebuild/build-123"
```

`percent` reflects `processedDocuments / totalDocuments`. `heartbeatAt` is updated
after every batch; monitoring should alert if a `running` build's heartbeat stops
for more than the 5-minute stale threshold.

## Resume an interrupted (stale) build

If a backend process crashes or is scaled down mid-rebuild, the build remains in
`running` state but its heartbeat goes stale. On the next boot the backend
auto-resumes the most recent stale build automatically (unless
`SKIP_BACKGROUND_JOBS=true`). An operator can also resume manually:

```bash
curl -X POST "https://api.example.com/api/v1/admin/search-index/rebuild" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"resume": true}'
```

The rebuild continues from the stored checkpoint cursor instead of starting over.

## Concurrency and errors

| Situation | Behavior |
| --- | --- |
| A rebuild is already running | New request rejected with `409 Conflict`. Retry after the build completes. |
| Another replica owns a fresh running build | Rejected with `409 Conflict` via Postgres advisory lock `955_355_955`. |
| `resume: true` but no interrupted build exists | `400 Bad Request`. |
| A stale running build exists and `resume` is not requested | The stale build is marked `failed` (superseded) and a fresh build starts. |
| Rebuild encounters an unexpected error mid-batch | Build is marked `failed` with `error` set; the checkpoint is retained so it can be resumed. |

## Index lifecycle & read behavior

- During a rebuild, new entries are upserted per entity `(entityType, entityId, orgId)`.
- When a rebuild **completes**, stale entries for each rebuilt entity type are
  purged (`deleteMany` on entity type where `buildId` is not the completed build).
- **Live search is never blocked**: admin search reads from `searchIndexEntry`
  when an org has entries, otherwise it falls back to the original live Prisma
  queries. Indexing operations are incremental and bounded per batch.

## Verification

1. Confirm the build reaches `completed`:

   ```bash
   curl -H "Authorization: Bearer $ADMIN_API_KEY" \
     "https://api.example.com/api/v1/admin/search-index/rebuild" | jq .status
   ```

2. Confirm `percent` is `100` and `completedAt` is set.
3. Run an admin search query and confirm results now resolve from the index.
4. Check audit log entries for `search-index` events: a `dry_run` action for dry
   runs and a `completed` action for full rebuilds.

## Troubleshooting

### Build stuck in `running` with an old heartbeat

The owner process likely died. Either wait for the stale threshold (5 min) and
resume, or resume manually:

```bash
curl -X POST ".../admin/search-index/rebuild" -d '{"resume": true}'
```

### `409 Conflict` on every attempt

A build is currently running (yours or another replica's). Poll the latest build
until it reaches `completed`/`failed`, then retry.

### Index appears empty on read

If the index has no entries for an org, search falls back to live queries, so
behavior remains correct. Trigger a rebuild (or rebuild the affected org's entity
types) to repopulate the index.

## Related

- [Database migrations](database-migrations.md)
- [Admin Key Policy for Testnet Deployments](admin-key-policy-testnet.md)

---

**Runbook Version**: 1.0  
**Last Updated**: 2026-09-24