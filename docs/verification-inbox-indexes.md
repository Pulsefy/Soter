# Verification inbox indexes

`VerificationInboxService.getInbox` is the query behind the reviewer inbox. It runs on
every page load of the review queue and has this shape:

```sql
SELECT ... FROM "VerificationRequest"
WHERE "deletedAt" IS NULL [AND "status" = $1]
ORDER BY "createdAt" DESC
LIMIT $2 OFFSET $3;
```

Before this change the only indexes on `VerificationRequest` were the single-column
`"deletedAt"`, `"status"` and `"reviewedAt"` indexes, none of which can satisfy the sort.
The status-filtered page fell back to a bitmap index scan over the status index plus a
top-N sort of every matching claim, and the unfiltered page fell back to a sequential scan
and a top-N sort of the whole table. Both degrade linearly as claim volume grows.

## Migration

`app/backend/prisma/migrations/20260926000000_add_verification_inbox_composite_index`

```sql
CREATE INDEX "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status", "createdAt" DESC);
CREATE INDEX "VerificationRequest_createdAt_idx" ON "VerificationRequest"("createdAt" DESC);
```

declared in `schema.prisma` as:

```prisma
  @@index([status, createdAt(sort: Desc)])
  @@index([createdAt(sort: Desc)])
```

* `(status, "createdAt" DESC)` is the composite index matching the inbox's actual
  WHERE/ORDER BY shape: the equality predicate fixes the leading key, the index supplies the
  descending order, so the scan stops after `LIMIT` rows.
* `("createdAt" DESC)` covers the unfiltered inbox page (no status filter), which has the
  same ORDER BY but no equality predicate to reduce the pathkeys with.

`"deletedAt"` is intentionally **not** an index key. PostgreSQL does not reduce index
pathkeys through a `NullTest`, so an index led by `"deletedAt"` cannot be used to satisfy
`ORDER BY "createdAt" DESC` — the planner falls back to the scan-plus-sort plans this
migration removes. `"deletedAt" IS NULL` therefore stays a filter on top of the ordered
scan, which is cheap because soft-deleted rows are a small fraction of the table.

The existing single-column `"deletedAt"`, `"status"` and `"reviewedAt"` indexes are kept:
they still serve the soft-delete, `groupBy(['status'])` stats and reviewed-at access paths
in the same service.

## EXPLAIN (ANALYZE, BUFFERS) before and after

Captured on PostgreSQL 15.16 against a synthetic 400k-row dataset built by
`app/backend/scripts/explain-verification-inbox.sql` (not production data). Reproduce with:

```bash
createdb soter_explain
psql -d soter_explain -f app/backend/scripts/explain-verification-inbox.sql
```

### Status-filtered inbox page (review queue default)

Before — bitmap scan + sort, 30.9 ms:

```
 Limit  (cost=7660.83..7663.17 rows=20 width=67) (actual time=27.404..30.836 rows=20 loops=1)
   ->  Gather Merge  (cost=7660.83..15112.85 rows=63870 width=67) (actual time=27.400..30.826 rows=20 loops=1)
         ->  Sort  (cost=6660.81..6740.65 rows=31935 width=67) (actual time=21.799..21.808 rows=18 loops=3)
               Sort Key: "createdAt" DESC
               Sort Method: top-N heapsort  Memory: 29kB
               ->  Parallel Bitmap Heap Scan on "VerificationRequest"  (actual time=1.456..17.131 rows=26280 loops=3)
                     Recheck Cond: (status = 'pending_review'::"VerificationStatus")
                     Filter: ("deletedAt" IS NULL)
                     ->  Bitmap Index Scan on "VerificationRequest_status_idx"  (actual time=3.529..3.529 rows=80416 loops=1)
 Execution Time: 30.883 ms
```

After — ordered index scan, 0.220 ms:

```
 Limit  (cost=0.42..5.70 rows=20 width=67) (actual time=0.103..0.172 rows=20 loops=1)
   Buffers: shared hit=20 read=4
   ->  Index Scan using "VerificationRequest_status_createdAt_idx" on "VerificationRequest"  (actual time=0.101..0.152 rows=20 loops=1)
         Index Cond: (status = 'pending_review'::"VerificationStatus")
         Filter: ("deletedAt" IS NULL)
         Buffers: shared hit=20 read=4
 Execution Time: 0.220 ms
```

### Unfiltered inbox page

Before — sequential scan + sort, 66.1 ms:

```
 Limit  (cost=11560.84..11563.17 rows=20 width=67) (actual time=62.602..66.050 rows=20 loops=1)
   ->  Gather Merge  (cost=11560.84..49691.33 rows=326810 width=67) (actual time=62.600..66.044 rows=20 loops=1)
         ->  Sort  (cost=10560.81..10969.33 rows=163405 width=67) (actual time=57.436..57.438 rows=16 loops=3)
               Sort Key: "createdAt" DESC
               Sort Method: top-N heapsort  Memory: 30kB
               ->  Parallel Seq Scan on "VerificationRequest"  (actual time=0.019..34.972 rows=130664 loops=3)
                     Filter: ("deletedAt" IS NULL)
 Execution Time: 66.079 ms
```

After — ordered index scan, 0.109 ms:

```
 Limit  (cost=0.42..1.88 rows=20 width=67) (actual time=0.058..0.088 rows=20 loops=1)
   Buffers: shared hit=20 read=3
   ->  Index Scan using "VerificationRequest_createdAt_idx" on "VerificationRequest"  (actual time=0.057..0.082 rows=20 loops=1)
         Filter: ("deletedAt" IS NULL)
         Buffers: shared hit=20 read=3
 Execution Time: 0.109 ms
```

Both plans now read a bounded number of buffers (20) instead of scanning the matching set,
which is what makes the inbox page load independent of claim volume.

## Write-amplification tradeoff

Every insert/update on `VerificationRequest` now maintains two more btree indexes. Measured
with `app/backend/scripts/write-amplification-verification-inbox.sql` on PostgreSQL 15.16
(400k rows seeded, then two 100k-row `INSERT ... SELECT` batches, one before and one after
the indexes exist):

| Measurement | Value |
| --- | --- |
| `INSERT` of 100k rows, inbox indexes absent | 2 045 / 2 149 / 2 115 ms |
| `INSERT` of 100k rows, inbox indexes present | 2 866 / 3 761 / 3 459 ms |
| `VerificationRequest_status_createdAt_idx` size @ 400k rows | 19 MB |
| `VerificationRequest_createdAt_idx` size @ 400k rows | 14 MB |
| Pre-existing `VerificationRequest_status_idx` size @ 400k rows | 3.8 MB |

That is **+40% to +75% on bulk insert throughput** (median ~+64%, single-threaded on a
laptop) and ~33 MB (~82 bytes per row) of extra index storage per 400k claims; every later
status change on a claim also maintains both indexes. Claims are inserted once but paged out
of the inbox many times, and this is the hottest read path in the service, so the trade is
worthwhile for a read-dominated table. If `VerificationRequest` ever becomes
write-dominated, `("createdAt" DESC)` is the first index to drop — the status-filtered
review queue is the primary path and keeps `(status, "createdAt" DESC)`.
