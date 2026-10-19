# Verification inbox composite index

Migration: `20261018170000_add_verification_inbox_composite_index`

Index: `VerificationRequest(status, deletedAt, createdAt DESC)`

Matches `VerificationInboxService.getInbox`:

```sql
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL AND "status" = 'pending_review'
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;
```

## Capturing EXPLAIN ANALYZE

Run against a representative dataset (e.g. staging, 100k+ rows) before and after
applying the migration, and paste the output below.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "VerificationRequest"
WHERE "deletedAt" IS NULL AND "status" = 'pending_review'
ORDER BY "createdAt" DESC
LIMIT 20;
```

- **Before:** expected `Index Scan on VerificationRequest_status_idx` (or Seq Scan)
  followed by a `Sort` node on `createdAt`.
- **After:** expected `Index Scan using VerificationRequest_status_deletedAt_createdAt_idx`
  with no `Sort` node.

_Measured output: not yet captured (needs a database; paste results here)._

## Write-amplification tradeoff

Each INSERT, and each UPDATE touching `status` or `deletedAt`, maintains one more
B-tree entry; `status` updates also prevent HOT updates. Review decisions are
human-rate, so the cost is small relative to the read savings. The old
single-column `status` index is now a prefix of the composite and can be dropped
in a follow-up once other users of it are confirmed.
