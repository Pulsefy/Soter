import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  canonicalMetadata,
  jsonDeepEqual,
} from './audit-chain.util';
import type { AuditLogParams } from './audit.service';

/**
 * Advisory lock key serializing all chain mutations (appends and backfill
 * batches). Held for the duration of the transaction that mutates the chain,
 * so concurrent workers cannot interleave appends.
 */
const AUDIT_CHAIN_LOCK_KEY = 724301951n;

/** Number of legacy rows sealed per backfill batch. */
const BACKFILL_BATCH_SIZE = 500;

/** Page size when walking the chain during verification. */
const VERIFY_PAGE_SIZE = 1000;

/** Upper bound on reported issues per verification run. */
const MAX_ISSUES = 50;

/** Status of one damaged entry found during chain verification. */
export interface ChainIssue {
  id: string;
  sequence: string | null;
  reason: string;
}

export interface ChainVerificationResult {
  /** `true` when every sealed entry is intact and correctly linked. */
  valid: boolean;
  /** Whether any legacy (pre-chain, unsealed) rows still exist. */
  backfillPending: boolean;
  /** Number of sealed (hash-chained) rows inspected. */
  sealedCount: number;
  /** Number of legacy rows awaiting backfill. */
  legacyCount: number;
  /**
   * Sealed rows whose content was legitimately rewritten by the retention
   * policy (anonymize strategy sets `deletedAt`): their content checks are
   * skipped and their stored hash is used only as a link anchor.
   */
  skippedAnonymized: number;
  /** First problems found, in chain order (the walk continues past issues). */
  issues: ChainIssue[];
  /** Sequence of the highest sealed entry, or null when the chain is empty. */
  headSequence: string | null;
  /** Hash of the highest sealed entry, or null when the chain is empty. */
  headHash: string | null;
}

export interface ChainBackfillResult {
  /** Rows sealed by this invocation. */
  sealed: number;
  /** Rows still awaiting backfill after this invocation. */
  remaining: number;
  headSequence: string | null;
  headHash: string | null;
}

@Injectable()
export class AuditChainService {
  private readonly logger = new Logger(AuditChainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Append one entry to the hash chain.
   *
   * Runs in an interactive transaction holding a Postgres advisory lock so
   * concurrent appends are strictly serialized: the entry is linked to the
   * current chain head and becomes the new head on commit.
   *
   * The `entryHash` covers the row's final `id` and database-generated
   * `timestamp`, so it is computed after the initial INSERT and persisted
   * with a second statement inside the same transaction — no intermediate
   * hash value is ever visible outside the transaction.
   */
  async appendToChain(params: AuditLogParams): Promise<{
    id: string;
    sequence: string;
    prevHash: string | null;
    entryHash: string;
    metadataCanonical: string;
  }> {
    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'chain_append',
      entity: 'AuditLog',
    });
    try {
      const result = await this.prisma.$transaction(async client =>
        this.appendInTx(client, params),
      );
      end();
      return result;
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'chain_append',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
  }

  private async appendInTx(
    client: Prisma.TransactionClient,
    params: AuditLogParams,
  ) {
    await client.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

    const head = await client.auditLog.findFirst({
      where: { entryHash: { not: null } },
      orderBy: { sequence: 'desc' },
      select: { sequence: true, entryHash: true },
    });

    const sequence = (head?.sequence ?? 0n) + 1n;
    const prevHash = head?.entryHash ?? GENESIS_PREV_HASH;
    const metadata = params.metadata ?? {};
    const metadataCanonical = canonicalMetadata(metadata);

    const created = await client.auditLog.create({
      data: {
        actorId: params.actorId,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        metadata: metadata as Prisma.InputJsonValue,
        sequence,
        prevHash,
        metadataCanonical,
      },
    });

    const entryHash = computeEntryHash({
      id: created.id,
      sequence,
      prevHash,
      actorId: created.actorId,
      entity: created.entity,
      entityId: created.entityId,
      action: created.action,
      timestamp: created.timestamp,
      metadataCanonical,
    });

    const final = await client.auditLog.update({
      where: { id: created.id },
      data: { entryHash },
      select: { id: true, metadataCanonical: true },
    });

    return {
      id: final.id,
      sequence: sequence.toString(),
      prevHash,
      entryHash,
      metadataCanonical: final.metadataCanonical ?? metadataCanonical,
    };
  }

  /**
   * Verify the integrity of the hash chain.
   *
   * Walks all sealed rows in `sequence` order, recomputing each hash and
   * checking its linkage. Detects:
   * - content mutation (stored `entryHash` no longer matches the row)
   * - broken links, i.e. middle insertion or deletion (`prevHash` mismatch)
   * - chain-head removal (first surviving entry no longer links to genesis)
   * - divergence between the visible `metadata` JSON and its canonical form
   *
   * Legacy (unsealed) rows cannot be integrity-checked — that is the point of
   * backfilling them — so they are only counted and surfaced via
   * `legacyCount` / `backfillPending`.
   *
   * `options.expectedHeadHash` anchors the chain externally: when provided
   * (e.g. the head hash recorded by a previous verification run or an
   * off-database copy), a mismatch is reported as an issue, which detects
   * truncation of the newest entries (deletion of the chain head). Without
   * an anchor, head deletion is undetectable from the table alone — the
   * surviving chain is internally consistent.
   */
  async verifyChain(options?: {
    expectedHeadHash?: string | null;
  }): Promise<ChainVerificationResult> {
    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'chain_verify',
      entity: 'AuditLog',
    });
    try {
      const result = await this.verify(options);
      end();
      return result;
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'chain_verify',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
  }

  private async verify(options?: {
    expectedHeadHash?: string | null;
  }): Promise<ChainVerificationResult> {
    const issues: ChainIssue[] = [];
    const sealedTotal = await this.prisma.auditLog.count({
      where: { entryHash: { not: null } },
    });
    const legacyCount = await this.prisma.auditLog.count({
      where: { entryHash: null },
    });

    if (sealedTotal === 0) {
      return {
        valid: true,
        backfillPending: legacyCount > 0,
        sealedCount: 0,
        legacyCount,
        skippedAnonymized: 0,
        issues,
        headSequence: null,
        headHash: null,
      };
    }

    let expectedPrevHash: string | null = GENESIS_PREV_HASH;
    let sealedCount = 0;
    let skippedAnonymized = 0;
    let headSequence: string | null = null;
    let headHash: string | null = null;
    // Per-row monotonicity tracker (distinct from the pagination cursor).
    let prevSeenSequence: bigint | null = null;

    // Walk sealed rows in ascending sequence order. `sequence` carries a
    // unique index; verification is an admin-only, on-demand operation.
    let lastSequence: bigint | null = null;
    let processed = 0;
    while (processed < sealedTotal && issues.length < MAX_ISSUES) {
      const pageArgs: Prisma.AuditLogFindManyArgs = {
        where: { entryHash: { not: null } },
        orderBy: { sequence: 'asc' },
        ...(lastSequence !== null
          ? { skip: 1, cursor: { sequence: lastSequence } }
          : {}),
        take: VERIFY_PAGE_SIZE,
        select: verifySelect,
      };
      const rows: Array<
        Prisma.AuditLogGetPayload<{ select: typeof verifySelect }>
      > = await this.prisma.auditLog.findMany(pageArgs);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (issues.length >= MAX_ISSUES) break;
        sealedCount += 1;

        const { sequence } = row;
        if (sequence === null) {
          // Appends assign sequence and entryHash in one transaction, so a
          // sealed row without a sequence cannot be linked into the chain.
          issues.push({
            id: row.id,
            sequence: null,
            reason: `sealed entry ${row.id} has no sequence and cannot be linked into the chain`,
          });
          continue;
        }

        // The walk visits rows in ascending `sequence` order, so a duplicate
        // or rewound sequence can only appear if the unique index was
        // bypassed (e.g. the index was dropped). Cheap sanity check.
        if (prevSeenSequence !== null && sequence <= prevSeenSequence) {
          issues.push({
            id: row.id,
            sequence: sequence.toString(),
            reason: `chain is not strictly increasing at seq ${sequence}: previous visited sequence was ${prevSeenSequence}`,
          });
        }
        prevSeenSequence = sequence;

        if (row.deletedAt !== null) {
          // The retention policy's anonymize strategy legitimately rewrites
          // actor/entity/metadata and stamps `deletedAt`. The original
          // content is intentionally destroyed, so content checks no longer
          // apply; the stored hash is still trusted as this entry's link
          // anchor. Documented limit: any row can be marked anonymized by a
          // database-level actor, which removes it from content checks.
          skippedAnonymized += 1;
          expectedPrevHash = row.entryHash;
          headSequence = sequence.toString();
          headHash = row.entryHash;
          continue;
        }

        try {
          foldSealedRow({ ...row, sequence }, expectedPrevHash);
        } catch (error) {
          issues.push({
            id: row.id,
            sequence: sequence.toString(),
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        // The expected link follows the row's stored hash regardless of
        // validity: everything after a damaged entry reports as broken until
        // the chain is repaired, which is the honest representation.
        expectedPrevHash = row.entryHash;
        headSequence = sequence.toString();
        headHash = row.entryHash;
      }

      lastSequence = rows[rows.length - 1].sequence;
      processed += rows.length;
    }

    const expectedHeadHash = options?.expectedHeadHash;
    if (
      expectedHeadHash &&
      headHash !== null &&
      headHash !== expectedHeadHash
    ) {
      issues.push({
        id: 'chain-head',
        sequence: headSequence,
        reason: `chain head mismatch: current head hash ${headHash} does not match the anchored head ${expectedHeadHash}; newest entries may have been deleted`,
      });
    }

    return {
      valid: issues.length === 0,
      backfillPending: legacyCount > 0,
      sealedCount,
      legacyCount,
      skippedAnonymized,
      issues,
      headSequence,
      headHash,
    };
  }

  /**
   * Seal legacy (pre-chain) rows that have no hash fields yet.
   *
   * Rows are processed oldest-first in batches. Each batch commits in its own
   * transaction guarded by the advisory lock, re-reading the chain head
   * inside the lock so concurrent appends can safely interleave. Because
   * already-sealed rows are skipped and sequences are assigned monotonically
   * under the lock, the process can be re-run after an interruption without
   * reassigning sequences.
   */
  async backfillChain(): Promise<ChainBackfillResult> {
    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'chain_backfill',
      entity: 'AuditLog',
    });
    try {
      let sealed = 0;
      const initialHead = await this.prisma.auditLog.findFirst({
        where: { entryHash: { not: null } },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, entryHash: true },
      });
      let head: { sequence: bigint; entryHash: string } | null = null;
      if (initialHead?.entryHash) {
        head = {
          sequence: initialHead.sequence ?? 0n,
          entryHash: initialHead.entryHash,
        };
      }

      for (;;) {
        const batchResult = await this.prisma.$transaction(async client => {
          await client.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

          // Re-read the head inside the lock; a concurrent append may have
          // extended the chain since the previous batch committed.
          const currentHead = await client.auditLog.findFirst({
            where: { entryHash: { not: null } },
            orderBy: { sequence: 'desc' },
            select: { sequence: true, entryHash: true },
          });

          const batch = await client.auditLog.findMany({
            where: { entryHash: null },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
            take: BACKFILL_BATCH_SIZE,
          });
          if (batch.length === 0) {
            return { sealed: 0, head: null };
          }

          let prevHash = currentHead?.entryHash ?? GENESIS_PREV_HASH;
          let sequence = currentHead?.sequence ?? 0n;

          for (const row of batch) {
            sequence += 1n;
            // Legacy rows carry all-null chain fields; anything else is an
            // unexpected partial state and aborts the backfill.
            if (row.prevHash !== null) {
              throw new Error(
                `legacy row ${row.id} has prevHash set but no entryHash; refusing to backfill`,
              );
            }
            const metadataCanonical =
              row.metadataCanonical ?? canonicalMetadata(row.metadata ?? null);
            const entryHash = computeEntryHash({
              id: row.id,
              sequence,
              prevHash,
              actorId: row.actorId,
              entity: row.entity,
              entityId: row.entityId,
              action: row.action,
              timestamp: row.timestamp,
              metadataCanonical,
            });
            await client.auditLog.update({
              where: { id: row.id },
              data: {
                sequence,
                prevHash,
                entryHash,
                ...(row.metadataCanonical === null
                  ? { metadataCanonical }
                  : {}),
              },
            });
            prevHash = entryHash;
          }

          return {
            sealed: batch.length,
            head: { sequence, entryHash: prevHash },
          };
        });

        sealed += batchResult.sealed;
        if (batchResult.head) head = batchResult.head;
        if (batchResult.sealed < BACKFILL_BATCH_SIZE) break;
      }

      const remaining = await this.prisma.auditLog.count({
        where: { entryHash: null },
      });

      if (sealed > 0) {
        this.logger.log(
          `Audit chain backfill sealed ${sealed} legacy row(s); ${remaining} remaining.`,
        );
      }

      return {
        sealed,
        remaining,
        headSequence: head?.sequence.toString() ?? null,
        headHash: head?.entryHash ?? null,
      };
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'chain_backfill',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
  }
}

/** Fields read from AuditLog during chain verification. */
const verifySelect = {
  id: true,
  sequence: true,
  prevHash: true,
  entryHash: true,
  actorId: true,
  entity: true,
  entityId: true,
  action: true,
  timestamp: true,
  metadata: true,
  metadataCanonical: true,
  deletedAt: true,
} as const satisfies Prisma.AuditLogSelect;

/**
 * Fold one sealed row: recompute its hash (from the canonical string recorded
 * at write time), verify the stored hash matches, verify the link to the
 * expected predecessor, and cross-check that the visible `metadata` JSON is
 * still logically equal to its canonical form (JSONB does not preserve key
 * order, so the comparison is order-insensitive).
 */
function foldSealedRow(
  row: {
    id: string;
    sequence: bigint;
    prevHash: string | null;
    entryHash: string | null;
    actorId: string;
    entity: string;
    entityId: string;
    action: string;
    timestamp: Date;
    metadata: Prisma.JsonValue | null;
    metadataCanonical: string | null;
  },
  expectedPrevHash: string | null,
): void {
  if (row.entryHash === null) {
    throw new Error(`entry ${row.id} is missing its entryHash`);
  }
  if (row.metadataCanonical === null) {
    throw new Error(`entry ${row.id} is missing its metadataCanonical`);
  }

  const entryHash = computeEntryHash({
    id: row.id,
    sequence: row.sequence,
    prevHash: row.prevHash,
    actorId: row.actorId,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    timestamp: row.timestamp,
    metadataCanonical: row.metadataCanonical,
  });
  if (entryHash !== row.entryHash) {
    throw new Error(
      `entry ${row.id} (seq ${row.sequence}) has an invalid entryHash: expected ${entryHash}, found ${row.entryHash}`,
    );
  }

  if (expectedPrevHash !== null) {
    const recorded = row.prevHash ?? GENESIS_PREV_HASH;
    if (recorded !== expectedPrevHash) {
      throw new Error(
        `broken link: entry ${row.id} (seq ${row.sequence}) records prevHash ${recorded}, but the previous chain entry hashes to ${expectedPrevHash}`,
      );
    }
  }

  const recomputed = canonicalMetadata(row.metadata ?? null);
  let canonicalMatchesMetadata = false;
  try {
    canonicalMatchesMetadata = jsonDeepEqual(
      JSON.parse(row.metadataCanonical),
      row.metadata ?? null,
    );
    if (
      !canonicalMatchesMetadata &&
      recomputed === row.metadataCanonical &&
      jsonDeepEqual(JSON.parse(recomputed), row.metadata ?? null)
    ) {
      // Canonical text differs only in formatting (e.g. written by an older
      // serializer) but denotes the same value — not tampering.
      canonicalMatchesMetadata = true;
    }
  } catch {
    canonicalMatchesMetadata = false;
  }
  if (!canonicalMatchesMetadata) {
    throw new Error(
      `entry ${row.id} (seq ${row.sequence}) metadata does not match its recorded canonical form`,
    );
  }
}
