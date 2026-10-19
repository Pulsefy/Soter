#!/usr/bin/env bash
#
# verify-backup.sh — prove the most recent database backup is restorable.
#
# Restores the latest backup into an isolated, disposable Postgres database and
# runs integrity checks against it: the backup is fresh, it restores without
# error, key tables exist with plausible row counts, and a smoke query across
# related tables succeeds. Any failure exits non-zero with a failure-mode
# specific code and (optionally) posts a backup-verification alert that is
# routed separately from normal operational alerts.
#
# Runbook: docs/database-backup-verification-runbook.md
#
# ── Backup source (one of) ────────────────────────────────────────────────────
#   BACKUP_FILE            Local path to a backup file.
#   BACKUP_S3_URI          s3://bucket/prefix/ — the newest object under the
#                          prefix is downloaded (requires the aws CLI).
#
# ── Restore target ────────────────────────────────────────────────────────────
#   RESTORE_DATABASE_URL   Connection string of the scratch database. Its
#                          `public` schema is DROPPED and recreated.
#   RESTORE_TARGET_IS_DISPOSABLE=true
#                          Required acknowledgement that the target may be wiped.
#   PROTECTED_DATABASE_URL Optional. If set and equal to RESTORE_DATABASE_URL the
#                          script refuses to run (guards against pointing the
#                          restore at production).
#
# ── Checks ────────────────────────────────────────────────────────────────────
#   BACKUP_MAX_AGE_HOURS   Max backup age before it is considered stale (26).
#   MIN_ROW_COUNTS         Comma-separated Table:min pairs. Every table listed
#                          must exist and hold at least `min` rows. Defaults to
#                          the core tables with a minimum of 1.
#   MIGRATIONS_DIR         Optional Prisma migrations directory. When set, the
#                          newest applied migration in the backup must exist
#                          there (catches a dump from an unknown schema).
#
# ── Alerting ──────────────────────────────────────────────────────────────────
#   BACKUP_ALERT_WEBHOOK_URL  Optional. Receives a JSON alert on failure.
#
# Formats: custom/tar dumps (*.dump, *.backup, *.tar → pg_restore),
#          plain SQL (*.sql → psql), gzipped SQL (*.sql.gz → gunzip | psql).
#
# Exit codes:
#   0  verified           20 backup not found / download failed
#   10 bad configuration  21 backup is stale
#   30 restore failed     40 integrity check failed   41 smoke query failed

set -euo pipefail

readonly EXIT_CONFIG=10
readonly EXIT_NOT_FOUND=20
readonly EXIT_STALE=21
readonly EXIT_RESTORE=30
readonly EXIT_INTEGRITY=40
readonly EXIT_SMOKE=41

DEFAULT_MIN_ROW_COUNTS='_prisma_migrations:1,Organization:1,User:1,Campaign:1,Claim:1,AuditLog:1'
MIN_ROW_COUNTS="${MIN_ROW_COUNTS:-$DEFAULT_MIN_ROW_COUNTS}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BACKUP_NAME="unknown"
CHECK_RESULTS=()

log() { printf '[verify-backup] %s\n' "$*" >&2; }

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

write_summary() {
  local status=$1 detail=$2
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "## Database backup verification: ${status}"
    echo
    echo "- **Backup:** \`${BACKUP_NAME}\`"
    echo "- **Detail:** ${detail}"
    if [ "${#CHECK_RESULTS[@]}" -gt 0 ]; then
      echo
      echo "| Check | Result |"
      echo "| --- | --- |"
      printf '%s\n' "${CHECK_RESULTS[@]}"
    fi
  } >>"$GITHUB_STEP_SUMMARY"
}

alert() {
  local mode=$1 message=$2
  [ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ] || return 0
  local payload
  payload=$(printf '{"source":"backup-verification","severity":"critical","failure_mode":"%s","backup":"%s","message":"%s","run_url":"%s"}' \
    "$(json_escape "$mode")" \
    "$(json_escape "$BACKUP_NAME")" \
    "$(json_escape "$message")" \
    "$(json_escape "${RUN_URL:-}")")
  if ! curl -fsS --max-time 15 -H 'Content-Type: application/json' \
    -d "$payload" "$BACKUP_ALERT_WEBHOOK_URL" >/dev/null; then
    log "WARNING: failed to deliver backup-verification alert"
  fi
}

fail() {
  local code=$1 mode=$2 message=$3
  log "FAILED [$mode]: $message"
  write_summary "FAILED ($mode)" "$message"
  alert "$mode" "$message"
  exit "$code"
}

psql_target() {
  psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -X -q "$@"
}

# ── Configuration ─────────────────────────────────────────────────────────────

check_config() {
  for tool in psql pg_restore; do
    command -v "$tool" >/dev/null 2>&1 ||
      fail $EXIT_CONFIG config "required tool '$tool' is not installed"
  done
  [ -n "${RESTORE_DATABASE_URL:-}" ] ||
    fail $EXIT_CONFIG config "RESTORE_DATABASE_URL is not set"
  [ "${RESTORE_TARGET_IS_DISPOSABLE:-}" = "true" ] ||
    fail $EXIT_CONFIG config "RESTORE_TARGET_IS_DISPOSABLE=true is required; the target's public schema is dropped"
  if [ -n "${PROTECTED_DATABASE_URL:-}" ] &&
    [ "$PROTECTED_DATABASE_URL" = "$RESTORE_DATABASE_URL" ]; then
    fail $EXIT_CONFIG config "RESTORE_DATABASE_URL points at the protected database; refusing to restore over it"
  fi
  if [ -z "${BACKUP_FILE:-}" ] && [ -z "${BACKUP_S3_URI:-}" ]; then
    fail $EXIT_CONFIG config "set BACKUP_FILE or BACKUP_S3_URI"
  fi
  [[ "$BACKUP_MAX_AGE_HOURS" =~ ^[0-9]+$ ]] ||
    fail $EXIT_CONFIG config "BACKUP_MAX_AGE_HOURS must be a whole number"
}

# ── Fetch ─────────────────────────────────────────────────────────────────────

# Sets BACKUP_PATH and BACKUP_MTIME (epoch seconds).
fetch_backup() {
  if [ -n "${BACKUP_FILE:-}" ]; then
    [ -f "$BACKUP_FILE" ] ||
      fail $EXIT_NOT_FOUND not_found "backup file '$BACKUP_FILE' does not exist"
    BACKUP_PATH="$BACKUP_FILE"
    BACKUP_NAME="$(basename "$BACKUP_FILE")"
    BACKUP_MTIME="$(stat -c %Y "$BACKUP_FILE" 2>/dev/null || stat -f %m "$BACKUP_FILE")"
    return
  fi

  command -v aws >/dev/null 2>&1 ||
    fail $EXIT_CONFIG config "BACKUP_S3_URI requires the aws CLI"

  local without_scheme=${BACKUP_S3_URI#s3://}
  local bucket=${without_scheme%%/*}
  local prefix=""
  [ "$without_scheme" != "$bucket" ] && prefix=${without_scheme#*/}

  local latest
  if ! latest=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" \
    --query 'sort_by(Contents, &LastModified)[-1].[Key, LastModified]' \
    --output text 2>&1); then
    fail $EXIT_NOT_FOUND not_found "could not list $BACKUP_S3_URI: $latest"
  fi
  if [ -z "$latest" ] || [ "$latest" = "None" ] || [[ "$latest" == None* ]]; then
    fail $EXIT_NOT_FOUND not_found "no backups found under $BACKUP_S3_URI"
  fi

  local key last_modified
  key=$(printf '%s' "$latest" | cut -f1)
  last_modified=$(printf '%s' "$latest" | cut -f2)
  BACKUP_NAME="s3://$bucket/$key"
  BACKUP_PATH="$WORK_DIR/$(basename "$key")"
  BACKUP_MTIME=$(date -d "$last_modified" +%s)

  log "downloading $BACKUP_NAME"
  aws s3 cp --only-show-errors "$BACKUP_NAME" "$BACKUP_PATH" ||
    fail $EXIT_NOT_FOUND download_failed "failed to download $BACKUP_NAME"
}

check_freshness() {
  local now age_hours
  now=$(date +%s)
  age_hours=$(((now - BACKUP_MTIME) / 3600))
  if [ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]; then
    CHECK_RESULTS+=("| Freshness | ❌ ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h) |")
    fail $EXIT_STALE stale "newest backup $BACKUP_NAME is ${age_hours}h old (max ${BACKUP_MAX_AGE_HOURS}h); backups may have stopped running"
  fi
  CHECK_RESULTS+=("| Freshness | ✅ ${age_hours}h old |")
  log "backup age ${age_hours}h (max ${BACKUP_MAX_AGE_HOURS}h)"
}

# ── Restore ───────────────────────────────────────────────────────────────────

restore_backup() {
  local size
  size=$(wc -c <"$BACKUP_PATH" | tr -d ' ')
  [ "$size" -gt 0 ] || fail $EXIT_RESTORE restore_failed "backup $BACKUP_NAME is empty (0 bytes)"

  log "resetting public schema on restore target"
  psql_target -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' ||
    fail $EXIT_RESTORE restore_failed "could not reset the restore target schema"

  local restore_log="$WORK_DIR/restore.log"
  local status=0
  log "restoring $BACKUP_NAME ($size bytes)"
  case "$BACKUP_PATH" in
  *.sql.gz)
    gunzip -c "$BACKUP_PATH" | psql_target >"$restore_log" 2>&1 || status=$?
    ;;
  *.sql)
    psql_target -f "$BACKUP_PATH" >"$restore_log" 2>&1 || status=$?
    ;;
  *)
    pg_restore --no-owner --no-privileges --exit-on-error \
      -d "$RESTORE_DATABASE_URL" "$BACKUP_PATH" >"$restore_log" 2>&1 || status=$?
    ;;
  esac

  if [ "$status" -ne 0 ]; then
    CHECK_RESULTS+=("| Restore | ❌ exit $status |")
    fail $EXIT_RESTORE restore_failed "restore exited $status: $(tail -n 5 "$restore_log" | tr '\n' ' ')"
  fi
  CHECK_RESULTS+=("| Restore | ✅ |")
}

# ── Integrity ─────────────────────────────────────────────────────────────────

check_row_counts() {
  local failures=() pairs=() pair table min exists count
  IFS=',' read -r -a pairs <<<"$MIN_ROW_COUNTS"
  for pair in "${pairs[@]}"; do
    table=${pair%%:*}
    min=${pair##*:}
    if ! [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || ! [[ "$min" =~ ^[0-9]+$ ]]; then
      fail $EXIT_CONFIG config "invalid MIN_ROW_COUNTS entry '$pair' (expected Table:min)"
    fi

    exists=$(psql_target -tA -c "SELECT to_regclass('public.\"$table\"') IS NOT NULL")
    if [ "$exists" != "t" ]; then
      CHECK_RESULTS+=("| \`$table\` | ❌ missing |")
      failures+=("$table missing")
      continue
    fi

    count=$(psql_target -tA -c "SELECT count(*) FROM public.\"$table\"")
    if [ "$count" -lt "$min" ]; then
      CHECK_RESULTS+=("| \`$table\` | ❌ $count rows (min $min) |")
      failures+=("$table has $count rows (min $min)")
    else
      CHECK_RESULTS+=("| \`$table\` | ✅ $count rows |")
    fi
    log "table $table: ${count} rows (min $min)"
  done

  if [ "${#failures[@]}" -gt 0 ]; then
    local joined
    joined=$(printf '%s; ' "${failures[@]}")
    fail $EXIT_INTEGRITY integrity "row-count check failed: ${joined%; }"
  fi
}

check_migrations() {
  local latest
  latest=$(psql_target -tA -c \
    "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1" 2>/dev/null) ||
    fail $EXIT_INTEGRITY integrity "could not read _prisma_migrations from the restored backup"

  [ -n "$latest" ] || fail $EXIT_INTEGRITY integrity "restored backup has no applied migrations"

  if [ -n "${MIGRATIONS_DIR:-}" ]; then
    if [ ! -d "$MIGRATIONS_DIR/$latest" ]; then
      CHECK_RESULTS+=("| Schema version | ❌ \`$latest\` unknown |")
      fail $EXIT_INTEGRITY integrity "newest applied migration '$latest' is not in $MIGRATIONS_DIR; the backup's schema is unknown to this codebase"
    fi
  fi
  CHECK_RESULTS+=("| Schema version | ✅ \`$latest\` |")
  log "newest applied migration: $latest"
}

run_smoke_query() {
  # Exercises a foreign-key join and an aggregate across core tables, which
  # fails if the restore produced tables without their data relationships.
  local result
  if ! result=$(psql_target -tA -c '
      SELECT count(*)
      FROM public."Claim" c
      JOIN public."Campaign" ca ON ca.id = c."campaignId"
      WHERE c."createdAt" <= now()' 2>&1); then
    CHECK_RESULTS+=("| Smoke query | ❌ |")
    fail $EXIT_SMOKE smoke_query "smoke query failed: $result"
  fi

  local orphans
  orphans=$(psql_target -tA -c '
      SELECT count(*) FROM public."Claim" c
      LEFT JOIN public."Campaign" ca ON ca.id = c."campaignId"
      WHERE ca.id IS NULL') ||
    fail $EXIT_SMOKE smoke_query "orphan check query failed"
  if [ "$orphans" -gt 0 ]; then
    CHECK_RESULTS+=("| Smoke query | ❌ $orphans orphaned claims |")
    fail $EXIT_SMOKE smoke_query "$orphans claims reference campaigns missing from the backup"
  fi

  CHECK_RESULTS+=("| Smoke query | ✅ $result joined claims |")
  log "smoke query ok ($result joined claims)"
}

main() {
  check_config
  fetch_backup
  check_freshness
  restore_backup
  check_row_counts
  check_migrations
  run_smoke_query
  write_summary "PASSED" "backup restored and passed integrity checks"
  log "PASSED: $BACKUP_NAME is restorable"
}

main "$@"
