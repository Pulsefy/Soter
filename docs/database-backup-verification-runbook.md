# Database Backup Verification Runbook

A backup that cannot be restored is not a backup. This runbook describes the
scheduled job that proves the latest Postgres backup restores cleanly, what
each failure means, and how to respond.

- **Workflow:** [`.github/workflows/db-backup-verification.yml`](../.github/workflows/db-backup-verification.yml)
- **Verifier:** [`scripts/db/verify-backup.sh`](../scripts/db/verify-backup.sh)
- **Verifier self-test:** [`scripts/db/verify-backup.selftest.sh`](../scripts/db/verify-backup.selftest.sh)

## What the job does

Every day at 04:17 UTC (after the nightly backup window), and on demand via
*Run workflow*, the `verify-latest-backup` job:

1. **Finds the newest backup**: the most recently modified object under
   `BACKUP_S3_URI`.
2. **Checks freshness**: fails if that backup is older than
   `BACKUP_MAX_AGE_HOURS` (default 26h). This catches backups that have
   *stopped running*, not only ones that are broken.
3. **Restores it into an isolated environment**: a throwaway `postgres:16`
   service container that exists only for the job. Production is never
   touched. The verifier also refuses to run unless the target is explicitly
   marked disposable (`RESTORE_TARGET_IS_DISPOSABLE=true`), and refuses if the
   target equals `PROTECTED_DATABASE_URL`.
4. **Runs integrity checks** on the restored database:
   - **Row counts:** every table in `MIN_ROW_COUNTS` exists and has at least
     the stated number of rows. The default is `_prisma_migrations`,
     `Organization`, `User`, `Campaign`, `Claim` and `AuditLog`, each with a
     minimum of 1.
   - **Schema version:** the newest applied Prisma migration in the backup
     exists in `app/backend/prisma/migrations`, so a dump from an unknown or
     diverged schema is flagged.
   - **Smoke query:** joins `Claim` → `Campaign` and checks for orphaned
     claims, which proves relationships survived the restore along with the
     tables.
5. **Reports**: writes a per-check table to the run's step summary.

Supported backup formats: `pg_dump` custom/tar archives (`*.dump`,
`*.backup`, `*.tar`, restored with `pg_restore`), plain SQL (`*.sql`) and
gzipped SQL (`*.sql.gz`).

The `self-test` job runs on pull requests that touch `scripts/db/**` or the
workflow. It builds known-good, truncated and stale backups from a freshly
migrated database and checks that the verifier passes or fails each one with
the expected exit code. That way a broken verifier cannot report a false pass.

## Alerting

Backup verification failures use their own alert path, separate from normal
operational alerts:

| Channel | Details |
| --- | --- |
| **GitHub issue** | An issue labelled `backup-verification-failure` is opened. Later failures comment on the open issue instead of opening duplicates. Close the issue when resolved. |
| **Webhook** (optional) | If `BACKUP_ALERT_WEBHOOK_URL` is set, the verifier POSTs `{"source":"backup-verification","severity":"critical","failure_mode":"…","backup":"…","message":"…","run_url":"…"}`. Route `source=backup-verification` to the data-durability on-call, not the general ops channel. |
| **Failed workflow run** | Shown in the Actions tab with the step summary. |

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `BACKUP_S3_URI` | secret | `s3://bucket/prefix/` where backups are written. |
| `BACKUP_AWS_ACCESS_KEY_ID` / `BACKUP_AWS_SECRET_ACCESS_KEY` | secret | **Read-only** credentials for the backup prefix (`s3:ListBucket`, `s3:GetObject`). |
| `BACKUP_ALERT_WEBHOOK_URL` | secret | Optional webhook for the dedicated alert. |
| `BACKUP_VERIFICATION_ENABLED` | variable | Set to `true` once configured. After that, missing secrets **fail** the run instead of skipping, so the job cannot stop verifying without anyone noticing. |
| `BACKUP_AWS_REGION` | variable | Defaults to `us-east-1`. |
| `BACKUP_MAX_AGE_HOURS` | variable | Freshness threshold; defaults to `26`. |
| `BACKUP_MIN_ROW_COUNTS` | variable | Overrides the default `Table:min` list, e.g. `Campaign:10,Claim:500,AuditLog:1000`. Raise the floors as production grows, so a backup that is suspiciously small is caught. |

Before setting `BACKUP_VERIFICATION_ENABLED`, the job skips with a warning.
This keeps forks without backup access green.

## Failure modes and response

The verifier's exit code and the alert's `failure_mode` identify the failure.

| Exit | `failure_mode` | Likely causes | Response |
| --- | --- | --- | --- |
| 10 | `config` | Missing secret or variable, malformed `BACKUP_MIN_ROW_COUNTS`, missing `psql`/`pg_restore`. | Fix the configuration. This is a problem with the job, not the backup, but the backup stays unverified until it is fixed. |
| 20 | `not_found` / `download_failed` | No objects under the prefix, credentials revoked or rotated, bucket policy changed, wrong region. | Check that backups are still being written to the prefix. If they are not, treat it as a **backup outage** (below). If they are, fix access for the read-only credentials. |
| 21 | `stale` | The backup job stopped running: cron disabled, disk full on the backup host, credentials for *writing* expired, or the job is failing silently. | Treat it as a **backup outage**. Check the backup producer's logs and take a manual backup right away. |
| 30 | `restore_failed` | Truncated upload, disk full during the dump, `pg_dump` newer than the `pg_restore` in the job, an extension the restore image lacks, corrupted object. | Look at the last lines of the restore log in the run output. On a version mismatch, update the service image and client in the workflow to match production's major version. On corruption, check the backup host's disk and logs, take a fresh backup, and verify it with *Run workflow*. |
| 40 | `integrity` | A table is missing or below its row floor, the newest migration is not known to the codebase, or `_prisma_migrations` is unreadable. | A table that is suddenly empty or small may mean the dump excluded it (for example a `--exclude-table` or permissions change) or that data was lost upstream. Compare with production counts. An unknown migration usually means the backup came from a different environment or branch, so check `BACKUP_S3_URI`. |
| 41 | `smoke_query` | Restored tables are missing columns or relationships, or claims reference campaigns that are not in the dump (a partial dump). | Same steps as `integrity`. Check whether the dump is partial (`--table` filters, per-schema dumps). |

### Backup outage procedure

If backups have stopped (`stale`, or `not_found` with no new objects):

1. Take a manual backup immediately:
   `pg_dump -Fc "$DATABASE_URL" -f soter-$(date -u +%Y%m%dT%H%MZ).dump` and
   upload it to the backup prefix.
2. Re-run this workflow with *Run workflow* and confirm it passes.
3. Find and fix the root cause in the backup producer, then record it on the
   `backup-verification-failure` issue.
4. Close the issue only after a **scheduled** run passes.

## Running locally

```bash
# Start a disposable restore target
docker run -d --rm --name restore-verify -p 55432:5432 \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=restore_verify postgres:16

BACKUP_FILE=./soter.dump \
RESTORE_DATABASE_URL=postgresql://postgres:verify@localhost:55432/restore_verify \
RESTORE_TARGET_IS_DISPOSABLE=true \
MIGRATIONS_DIR=app/backend/prisma/migrations \
  scripts/db/verify-backup.sh

docker stop restore-verify
```

Never point `RESTORE_DATABASE_URL` at a database you care about. The verifier
drops and recreates its `public` schema. Set `PROTECTED_DATABASE_URL` to your
production URL as an extra safeguard.
