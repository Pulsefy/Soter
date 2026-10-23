#!/usr/bin/env bash
#
# verify-backup.selftest.sh — exercise verify-backup.sh against known-good and
# known-bad backups so a regression in the verifier itself is caught in CI
# rather than discovered during an incident.
#
# Requires:
#   SOURCE_DATABASE_URL   A database already migrated to the current schema
#                         (rows are inserted into it).
#   RESTORE_DATABASE_URL  A separate, disposable database used as the restore
#                         target.

set -euo pipefail

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Seeding core tables in the source database"
psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -X -q <<'SQL'
INSERT INTO "Organization"(id, name, "updatedAt") VALUES ('selftest-org', 'Self-test org', now());
INSERT INTO "User"(id, email, "updatedAt") VALUES ('selftest-user', 'selftest@example.org', now());
INSERT INTO "Campaign"(id, name, budget, "updatedAt") VALUES ('selftest-campaign', 'Self-test campaign', 100, now());
INSERT INTO "Claim"(id, "campaignId", amount, "recipientRef", "updatedAt") VALUES ('selftest-claim', 'selftest-campaign', 10, 'selftest-recipient', now());
INSERT INTO "AuditLog"(id, action, "entityId", entity, "actorId") VALUES ('selftest-audit', 'selftest', 'selftest', 'SelfTest', 'selftest-user');
SQL

pg_dump -Fc -d "$SOURCE_DATABASE_URL" -f "$WORK_DIR/good.dump"
pg_dump -d "$SOURCE_DATABASE_URL" | gzip >"$WORK_DIR/good.sql.gz"
head -c 2048 "$WORK_DIR/good.dump" >"$WORK_DIR/truncated.dump"
cp "$WORK_DIR/good.dump" "$WORK_DIR/stale.dump"
touch -d '3 days ago' "$WORK_DIR/stale.dump"

failures=0

# expect <exit code> <description> [VAR=value ...]
expect() {
  local want=$1 description=$2
  shift 2
  local got=0
  env RESTORE_TARGET_IS_DISPOSABLE=true \
    MIGRATIONS_DIR="$REPO_ROOT/app/backend/prisma/migrations" \
    BACKUP_ALERT_WEBHOOK_URL= GITHUB_STEP_SUMMARY= \
    "$@" "$SCRIPT_DIR/verify-backup.sh" >"$WORK_DIR/out.log" 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   - $description (exit $got)"
  else
    echo "FAIL - $description: expected exit $want, got $got"
    sed 's/^/       /' "$WORK_DIR/out.log"
    failures=$((failures + 1))
  fi
}

expect 0 "custom-format dump restores and passes checks" BACKUP_FILE="$WORK_DIR/good.dump"
expect 0 "gzipped SQL dump restores and passes checks" BACKUP_FILE="$WORK_DIR/good.sql.gz"
expect 20 "missing backup file is reported" BACKUP_FILE="$WORK_DIR/does-not-exist.dump"
expect 21 "stale backup is reported" BACKUP_FILE="$WORK_DIR/stale.dump"
expect 30 "truncated backup fails to restore" BACKUP_FILE="$WORK_DIR/truncated.dump"
expect 40 "row-count floor is enforced" BACKUP_FILE="$WORK_DIR/good.dump" MIN_ROW_COUNTS="Claim:1000"
expect 40 "missing key table is reported" BACKUP_FILE="$WORK_DIR/good.dump" MIN_ROW_COUNTS="NoSuchTable:0"
expect 10 "restoring over the protected database is refused" BACKUP_FILE="$WORK_DIR/good.dump" PROTECTED_DATABASE_URL="$RESTORE_DATABASE_URL"
expect 10 "an unacknowledged restore target is refused" BACKUP_FILE="$WORK_DIR/good.dump" RESTORE_TARGET_IS_DISPOSABLE=false

if [ "$failures" -gt 0 ]; then
  echo "$failures self-test case(s) failed"
  exit 1
fi
echo "All verify-backup self-test cases passed"
