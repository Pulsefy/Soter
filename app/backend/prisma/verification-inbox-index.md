# Verification inbox index

`VerificationInboxService.getInbox(status, page, limit)` issues this queue query when a status is supplied:

```sql
SELECT *
FROM "VerificationRequest"
WHERE "deletedAt" IS NULL
  AND "status" = $1
ORDER BY "createdAt" DESC
OFFSET $2
LIMIT $3;
```

Migration `20260928000000_add_verification_inbox_index` adds the PostgreSQL partial composite index
`"VerificationRequest_status_createdAt_active_idx"` on `("status", "createdAt" DESC) WHERE "deletedAt" IS NULL`.
The equality predicate on `status` lets PostgreSQL read each queue in `createdAt DESC` order directly; the partial predicate excludes soft-deleted requests. It is deliberately not represented as a Prisma `@@index`, because Prisma schema indexes cannot express this partial-index predicate.

## EXPLAIN ANALYZE evidence

The query above was analyzed on the locally reachable PostgreSQL 18 server. That server did not contain the application's `soter_db`, so a disposable validation schema was created with the `VerificationRequest` fields, the three pre-existing single-column indexes, and 100,000 representative rows (1% `pending_review`, 10% soft-deleted). The validation schema was removed after the measurements. The application query shape, PostgreSQL version, index definitions, and `LIMIT 20` were the same; timings are therefore illustrative, while index selection is directly observed.

Before adding the composite index:

```text
Limit  (cost=0.29..91.56 rows=20 width=142) (actual time=0.152..1.135 rows=20.00 loops=1)
  ->  Index Scan Backward using verificationrequest_createdat_idx on verificationrequest
        Filter: ((deletedat IS NULL) AND (status = 'pending_review'::text))
        Rows Removed by Filter: 1980
Planning Time: 15.615 ms
Execution Time: 1.685 ms
```

After adding `VerificationRequest_status_createdAt_active_idx`:

```text
Limit  (cost=0.42..54.92 rows=20 width=38) (actual time=0.287..0.318 rows=20.00 loops=1)
  ->  Index Scan using "VerificationRequest_status_createdAt_active_idx" on "VerificationRequest"
        Index Cond: (status = 'pending_review'::text)
Planning Time: 4.307 ms
Execution Time: 3.312 ms
```

The post-migration index scan has no filter or sort node: the partial predicate guarantees active rows and the equality prefix plus descending `createdAt` provides the requested queue order. On a migrated application database, capture its environment-specific plan with:

```sql
EXPLAIN ANALYZE
SELECT *
FROM "VerificationRequest"
WHERE "deletedAt" IS NULL
  AND "status" = 'pending_review'
ORDER BY "createdAt" DESC
OFFSET 0
LIMIT 20;
```

Before this migration, the available indexes are individual `status`, `createdAt`, and `deletedAt` indexes, so PostgreSQL must either filter then sort or scan an index that does not cover all predicates/order. After applying the migration, confirm the plan names `VerificationRequest_status_createdAt_active_idx`; it can satisfy both the active-status filter and descending queue order without a separate sort.

## Tradeoff

The index consumes additional storage. Inserts, deletes, and updates to `status`, `createdAt`, or `deletedAt` also require index maintenance. That write cost is justified because the operator-facing, status-filtered verification inbox is a frequent latency-sensitive review path and the partial index omits soft-deleted rows.
