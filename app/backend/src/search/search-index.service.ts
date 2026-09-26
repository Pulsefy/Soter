import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, SearchIndexEntityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_SEARCH_INDEX_BATCH_SIZE,
  MAX_SEARCH_INDEX_BATCH_SIZE,
  MIN_SEARCH_INDEX_BATCH_SIZE,
  SEARCH_INDEX_ADVISORY_LOCK_KEY,
  SEARCH_INDEX_BUILD_MODE_DRY_RUN,
  SEARCH_INDEX_BUILD_MODE_REBUILD,
  SEARCH_INDEX_ENTITY_TYPES,
  SEARCH_INDEX_STALE_THRESHOLD_MS,
} from './search-index.constants';

type Tx = Prisma.TransactionClient;

export interface RebuildOptions {
  dryRun?: boolean;
  resume?: boolean;
  batchSize?: number;
  entityTypes?: SearchIndexEntityType[];
  triggeredBy?: string;
}

export type RebuildMode = 'rebuild' | 'dry_run';

export interface RebuildProgress {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: RebuildMode;
  entityTypes: SearchIndexEntityType[];
  batchSize: number;
  triggeredBy: string | null;
  totalDocuments: number;
  processedDocuments: number;
  percent: number;
  checkpoint: Record<string, unknown> | null;
  statistics: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  heartbeatAt: Date | null;
}

interface EntityCursorState {
  cursor?: string;
  done: boolean;
}

type RebuildCheckpoint = Partial<
  Record<SearchIndexEntityType, EntityCursorState>
>;

interface IndexRecord {
  entityType: SearchIndexEntityType;
  entityId: string;
  orgId: string;
  label: string;
  status: string;
  searchText: string;
}

interface EntityBatch {
  records: IndexRecord[];
  nextCursor?: string;
}

type EntityCounts = Record<SearchIndexEntityType, number>;

const normalize = (values: string[]): string =>
  values
    .filter(Boolean)
    .map(v => v.trim().toLowerCase())
    .join(' ');

/**
 * Orchestrates safe, admin-triggered rebuilds of the materialized search index
 * backing `AdminSearchService.search`.
 *
 * Safety properties:
 * - Work is done in bounded batches (keyset pagination), leaving the event loop
 *   free for live search reads.
 * - Progress and per-entity checkpoints are persisted, so an interrupted
 *   rebuild can be resumed instead of restarted.
 * - A dry run reports document counts without writing to `SearchIndexEntry`.
 * - Concurrent rebuild requests are rejected (409) rather than interleaved.
 */
@Injectable()
export class SearchIndexService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexService.name);
  private activeBuildId: string | null = null;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SKIP_BACKGROUND_JOBS === 'true') {
      return;
    }
    try {
      await this.resumeInterruptedBuilds();
    } catch (error) {
      this.logger.error(
        'Failed to resume interrupted search index builds',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Claims and (for a real rebuild) starts an index rebuild. Rejects with a
   * ConflictException when another rebuild is already active.
   */
  async startRebuild(options: RebuildOptions): Promise<RebuildProgress> {
    const batchSize = this.clampBatchSize(options.batchSize);
    const entityTypes = this.resolveEntityTypes(options.entityTypes);

    type Claim =
      | { kind: 'created'; buildId: string; dryRun: boolean }
      | { kind: 'resumed'; buildId: string };

    // The claim is serialized across instances with a transaction-scoped
    // Postgres advisory lock so a burst of requests never interleaves.
    const claim = await this.prisma.$transaction(
      async (tx: Tx): Promise<Claim> => {
        const [lockRow] = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
          'SELECT pg_try_advisory_xact_lock($1) AS "locked"',
          SEARCH_INDEX_ADVISORY_LOCK_KEY,
        );
        if (!lockRow?.locked) {
          throw new ConflictException(
            'A search index rebuild request is already being claimed; retry shortly',
          );
        }

        if (this.activeBuildId) {
          throw new ConflictException(
            `A search index rebuild (${this.activeBuildId}) is already running in this process`,
          );
        }

        const running = await tx.searchIndexBuild.findFirst({
          where: { status: 'running' },
          orderBy: { createdAt: 'desc' },
        });

        if (running) {
          const heartbeatMs =
            running.heartbeatAt?.getTime() ?? running.updatedAt.getTime();
          const stale =
            Date.now() - heartbeatMs > SEARCH_INDEX_STALE_THRESHOLD_MS;

          if (options.resume) {
            if (!stale) {
              throw new ConflictException(
                `Search index rebuild ${running.id} is still active, so it cannot be resumed yet`,
              );
            }
            return { kind: 'resumed', buildId: running.id };
          }

          if (!stale) {
            throw new ConflictException(
              `A search index rebuild (${running.id}) is already in progress; concurrent rebuilds are rejected. Wait for it to finish, or pass resume=true after it stalls.`,
            );
          }

          await tx.searchIndexBuild.update({
            where: { id: running.id },
            data: {
              status: 'failed',
              error: 'Superseded by a fresh rebuild after becoming stale',
              completedAt: new Date(),
            },
          });
        } else if (options.resume) {
          throw new BadRequestException(
            'No interrupted search index rebuild to resume',
          );
        }

        const mode = options.dryRun
          ? SEARCH_INDEX_BUILD_MODE_DRY_RUN
          : SEARCH_INDEX_BUILD_MODE_REBUILD;
        const build = await tx.searchIndexBuild.create({
          data: {
            status: 'running',
            mode,
            entityTypes: entityTypes,
            batchSize,
            triggeredBy: options.triggeredBy ?? null,
            ...(mode === SEARCH_INDEX_BUILD_MODE_REBUILD
              ? {
                  checkpoint:
                    this.emptyCheckpoint() as unknown as Prisma.InputJsonValue,
                }
              : {}),
          },
        });

        return {
          kind: 'created',
          buildId: build.id,
          dryRun: options.dryRun === true,
        };
      },
    );

    if (claim.kind === 'resumed') {
      return this.resumeBuild(claim.buildId, options.triggeredBy);
    }

    if (claim.dryRun) {
      return this.runDryRun(claim.buildId, options.triggeredBy);
    }

    this.activeBuildId = claim.buildId;

    const counts = await this.countDocuments();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    await this.prisma.searchIndexBuild.update({
      where: { id: claim.buildId },
      data: {
        totalDocuments: total,
        statistics: { counts },
      },
    });

    void this.fireProcessing(claim.buildId);
    return this.getProgress(claim.buildId);
  }

  async getProgress(buildId: string): Promise<RebuildProgress> {
    const build = await this.prisma.searchIndexBuild.findUnique({
      where: { id: buildId },
    });
    if (!build) {
      throw new NotFoundException(`Search index build ${buildId} not found`);
    }
    return this.toProgress(build);
  }

  async getLatestProgress(): Promise<RebuildProgress | null> {
    const build = await this.prisma.searchIndexBuild.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return build ? this.toProgress(build) : null;
  }

  /** Resolves when an in-process rebuild run has finished (useful to scripts). */
  async waitForBuild(buildId: string): Promise<void> {
    const promise = this.inFlight.get(buildId);
    if (promise) {
      await promise;
    }
  }

  // ---------------------------------------------------------------------------
  // Rebuild execution
  // ---------------------------------------------------------------------------

  private async resumeBuild(
    buildId: string,
    triggeredBy?: string,
  ): Promise<RebuildProgress> {
    const build = await this.prisma.searchIndexBuild.findUnique({
      where: { id: buildId },
    });
    if (!build) {
      throw new NotFoundException(`Search index build ${buildId} not found`);
    }
    if (build.status !== 'running') {
      throw new ConflictException(
        `Search index build ${buildId} is not resumable (status=${build.status})`,
      );
    }

    if (triggeredBy) {
      await this.prisma.searchIndexBuild.update({
        where: { id: buildId },
        data: { triggeredBy: triggeredBy ?? build.triggeredBy },
      });
    }

    void this.fireProcessing(buildId);
    return this.getProgress(buildId);
  }

  private async runDryRun(
    buildId: string,
    triggeredBy?: string,
  ): Promise<RebuildProgress> {
    const counts = await this.countDocuments();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    await this.prisma.searchIndexBuild.update({
      where: { id: buildId },
      data: {
        status: 'completed',
        totalDocuments: total,
        processedDocuments: total,
        statistics: { counts },
        triggeredBy: triggeredBy ?? null,
        completedAt: new Date(),
      },
    });

    await this.auditService.record({
      actorId: triggerActor(triggeredBy),
      entity: 'SearchIndexBuild',
      entityId: buildId,
      action: 'dry_run',
      metadata: { counts },
    });

    this.logger.log(
      `[search-index] dry run ${buildId} complete: ${JSON.stringify(counts)}`,
    );
    return this.getProgress(buildId);
  }

  private fireProcessing(buildId: string): void {
    this.activeBuildId = buildId;
    const promise = this.processBuild(buildId);
    this.inFlight.set(buildId, promise);
    void promise
      .catch(error => {
        this.logger.error(
          `[search-index] unexpected failure in build ${buildId}`,
          error instanceof Error ? error.stack : String(error),
        );
      })
      .finally(() => this.inFlight.delete(buildId));
  }

  /**
   * Runs a rebuild to completion in bounded batches, persisting progress after
   * every batch so an interruption can be resumed from the stored checkpoint.
   */
  private async processBuild(buildId: string): Promise<void> {
    const build = await this.prisma.searchIndexBuild.findUnique({
      where: { id: buildId },
    });
    if (!build) {
      throw new NotFoundException(`Search index build ${buildId} not found`);
    }
    if (build.mode === SEARCH_INDEX_BUILD_MODE_DRY_RUN) {
      return;
    }
    if (build.status !== 'running') {
      return;
    }
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new ConflictException(
        `Search index build ${this.activeBuildId} is already running in this process`,
      );
    }

    this.activeBuildId = buildId;

    try {
      const entityTypes = this.resolveEntityTypes(build.entityTypes);
      const batchSize = this.clampBatchSize(build.batchSize);
      const checkpoint: RebuildCheckpoint =
        (build.checkpoint as RebuildCheckpoint | null) ??
        this.emptyCheckpoint();
      let processed = build.processedDocuments ?? 0;

      for (const entityType of entityTypes) {
        const state = checkpoint[entityType] ?? {
          cursor: undefined,
          done: false,
        };
        checkpoint[entityType] = state;

        if (state.done) {
          this.logger.log(
            `[search-index] build ${buildId}: ${entityType} already complete, skipping`,
          );
          continue;
        }

        const seen = new Set<string>();
        let done = false;
        while (!done) {
          const batch = await this.scanEntityBatch(
            entityType,
            state.cursor,
            batchSize,
            seen,
          );

          if (batch.records.length > 0) {
            await this.upsertBatch(batch.records, buildId);
          }

          state.cursor = batch.nextCursor;
          done = batch.nextCursor === undefined;
          processed += batch.records.length;
          state.done = done;

          await this.persistCheckpoint(buildId, checkpoint, processed);

          if (!done) {
            await this.tick();
          }
        }

        this.logger.log(
          `[search-index] build ${buildId}: ${entityType} indexed (running total ${processed})`,
        );
      }

      // Purge entries for rebuilt types that no longer exist in the source data.
      for (const entityType of entityTypes) {
        const { count: removed } =
          await this.prisma.searchIndexEntry.deleteMany({
            where: { entityType, buildId: { not: buildId } },
          });
        if (removed > 0) {
          this.logger.log(
            `[search-index] build ${buildId}: purged ${removed} stale ${entityType} entries`,
          );
        }
      }

      await this.prisma.searchIndexBuild.update({
        where: { id: buildId },
        data: {
          status: 'completed',
          processedDocuments: processed,
          checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });

      await this.auditService.record({
        actorId: triggerActor(build.triggeredBy),
        entity: 'SearchIndexBuild',
        entityId: buildId,
        action: 'completed',
        metadata: { processedDocuments: processed, entityTypes },
      });

      this.logger.log(
        `[search-index] build ${buildId} completed: ${processed} documents indexed`,
      );
    } catch (error) {
      await this.failBuild(buildId, error);
    } finally {
      if (this.activeBuildId === buildId) {
        this.activeBuildId = null;
      }
    }
  }

  private async failBuild(buildId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `[search-index] build ${buildId} failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    await this.prisma.searchIndexBuild.update({
      where: { id: buildId },
      data: {
        status: 'failed',
        error: message,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Bounded batch scanning
  // ---------------------------------------------------------------------------

  private async scanEntityBatch(
    entityType: SearchIndexEntityType,
    cursor: string | undefined,
    batchSize: number,
    seen: Set<string>,
  ): Promise<EntityBatch> {
    switch (entityType) {
      case SearchIndexEntityType.campaign:
        return this.scanCampaigns(cursor, batchSize);
      case SearchIndexEntityType.claim:
        return this.scanClaims(cursor, batchSize);
      case SearchIndexEntityType.recipient:
        return this.scanRecipients(cursor, batchSize, seen);
      case SearchIndexEntityType.verification:
        return this.scanVerifications(cursor, batchSize);
    }
  }

  private async scanCampaigns(
    cursor: string | undefined,
    batchSize: number,
  ): Promise<EntityBatch> {
    const rows = await this.prisma.campaign.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const records: IndexRecord[] = [];
    for (const row of rows) {
      const orgId = row.orgId ?? row.ngoId;
      if (!orgId) continue;
      records.push({
        entityType: SearchIndexEntityType.campaign,
        entityId: row.id,
        orgId,
        label: row.name,
        status: row.status,
        searchText: normalize([row.name, row.id]),
      });
    }

    return { records, nextCursor: rows.at(-1)?.id };
  }

  private async scanClaims(
    cursor: string | undefined,
    batchSize: number,
  ): Promise<EntityBatch> {
    const rows = await this.prisma.claim.findMany({
      where: { deletedAt: null, campaign: { orgId: { not: null } } },
      select: {
        id: true,
        recipientRef: true,
        status: true,
        campaign: { select: { orgId: true } },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const records: IndexRecord[] = [];
    for (const row of rows) {
      const orgId = row.campaign?.orgId;
      if (!orgId) continue;
      records.push({
        entityType: SearchIndexEntityType.claim,
        entityId: row.id,
        orgId,
        label: `Claim ${row.id}`,
        status: row.status,
        searchText: normalize([row.id, row.recipientRef]),
      });
    }

    return { records, nextCursor: rows.at(-1)?.id };
  }

  private async scanRecipients(
    cursor: string | undefined,
    batchSize: number,
    seen: Set<string>,
  ): Promise<EntityBatch> {
    const rows = await this.prisma.claim.findMany({
      where: {
        deletedAt: null,
        recipientRef: { not: { equals: '' } },
        campaign: { orgId: { not: null } },
      },
      select: {
        id: true,
        recipientRef: true,
        campaign: { select: { orgId: true } },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const records: IndexRecord[] = [];
    for (const row of rows) {
      const orgId = row.campaign?.orgId;
      if (!orgId || !row.recipientRef) continue;
      const key = `${orgId}|${row.recipientRef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        entityType: SearchIndexEntityType.recipient,
        entityId: row.recipientRef,
        orgId,
        label: row.recipientRef,
        status: 'active',
        searchText: normalize([row.recipientRef]),
      });
    }

    return { records, nextCursor: rows.at(-1)?.id };
  }

  private async scanVerifications(
    cursor: string | undefined,
    batchSize: number,
  ): Promise<EntityBatch> {
    const rows = await this.prisma.verificationSession.findMany({
      where: { deletedAt: null, orgId: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const records: IndexRecord[] = [];
    for (const row of rows) {
      if (!row.orgId) continue;
      records.push({
        entityType: SearchIndexEntityType.verification,
        entityId: row.id,
        orgId: row.orgId,
        label: row.identifier,
        status: row.status,
        searchText: normalize([row.identifier, row.id]),
      });
    }

    return { records, nextCursor: rows.at(-1)?.id };
  }

  private async upsertBatch(
    records: IndexRecord[],
    buildId: string,
  ): Promise<void> {
    for (const record of records) {
      await this.prisma.searchIndexEntry.upsert({
        where: {
          entityType_entityId_orgId: {
            entityType: record.entityType,
            entityId: record.entityId,
            orgId: record.orgId,
          },
        },
        create: { ...record, buildId },
        update: {
          label: record.label,
          status: record.status,
          searchText: record.searchText,
          buildId,
        },
      });
    }
  }

  private async persistCheckpoint(
    buildId: string,
    checkpoint: RebuildCheckpoint,
    processed: number,
  ): Promise<void> {
    await this.prisma.searchIndexBuild.update({
      where: { id: buildId },
      data: {
        processedDocuments: processed,
        checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
        heartbeatAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Document counts
  // ---------------------------------------------------------------------------

  private async countDocuments(): Promise<EntityCounts> {
    const [campaign, claim, verification, recipientGroups] = await Promise.all([
      this.prisma.campaign.count({
        where: {
          deletedAt: null,
          OR: [{ orgId: { not: null } }, { ngoId: { not: null } }],
        },
      }),
      this.prisma.claim.count({
        where: { deletedAt: null, campaign: { orgId: { not: null } } },
      }),
      this.prisma.verificationSession.count({
        where: { deletedAt: null, orgId: { not: null } },
      }),
      this.prisma.claim.groupBy({
        by: ['recipientRef'],
        where: {
          deletedAt: null,
          recipientRef: { not: { equals: '' } },
          campaign: { orgId: { not: null } },
        },
      }),
    ]);

    return {
      campaign,
      claim,
      recipient: recipientGroups.length,
      verification,
    };
  }

  // ---------------------------------------------------------------------------
  // Interrupted-build recovery
  // ---------------------------------------------------------------------------

  /** Resumes a stale running build on process start (crash recovery). */
  private async resumeInterruptedBuilds(): Promise<void> {
    const running = await this.prisma.searchIndexBuild.findFirst({
      where: { status: 'running' },
      orderBy: { createdAt: 'desc' },
    });

    if (!running) {
      return;
    }

    const heartbeatMs =
      running.heartbeatAt?.getTime() ?? running.updatedAt.getTime();
    const stale = Date.now() - heartbeatMs > SEARCH_INDEX_STALE_THRESHOLD_MS;
    if (!stale) {
      this.logger.log(
        `[search-index] build ${running.id} is still active elsewhere; not resuming`,
      );
      return;
    }

    this.logger.warn(
      `[search-index] resuming interrupted build ${running.id} from checkpoint`,
    );
    void this.fireProcessing(running.id);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emptyCheckpoint(): RebuildCheckpoint {
    const checkpoint: RebuildCheckpoint = {};
    for (const entityType of SEARCH_INDEX_ENTITY_TYPES) {
      checkpoint[entityType] = { cursor: undefined, done: false };
    }
    return checkpoint;
  }

  private resolveEntityTypes(input: unknown): SearchIndexEntityType[] {
    if (!Array.isArray(input) || input.length === 0) {
      return [...SEARCH_INDEX_ENTITY_TYPES];
    }
    const known = new Set<SearchIndexEntityType>(SEARCH_INDEX_ENTITY_TYPES);
    const resolved: SearchIndexEntityType[] = [];
    for (const value of input) {
      const candidate = String(value) as SearchIndexEntityType;
      if (known.has(candidate) && !resolved.includes(candidate)) {
        resolved.push(candidate);
      }
    }
    if (resolved.length === 0) {
      throw new BadRequestException(
        'No supported search index entity types were provided',
      );
    }
    return resolved;
  }

  private clampBatchSize(batchSize?: number): number {
    if (batchSize === undefined) {
      return DEFAULT_SEARCH_INDEX_BATCH_SIZE;
    }
    return Math.min(
      MAX_SEARCH_INDEX_BATCH_SIZE,
      Math.max(MIN_SEARCH_INDEX_BATCH_SIZE, Math.round(batchSize)),
    );
  }

  private tick(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
  }

  private toProgress(build: {
    id: string;
    status: string;
    mode: string;
    entityTypes: unknown;
    batchSize: number;
    triggeredBy: string | null;
    totalDocuments: number;
    processedDocuments: number;
    checkpoint: unknown;
    statistics: unknown;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
    updatedAt: Date;
    heartbeatAt: Date | null;
  }): RebuildProgress {
    const total = build.totalDocuments;
    const processed = build.processedDocuments;
    return {
      id: build.id,
      status: build.status as RebuildProgress['status'],
      mode: build.mode as RebuildMode,
      entityTypes: this.resolveEntityTypes(build.entityTypes),
      batchSize: build.batchSize,
      triggeredBy: build.triggeredBy,
      totalDocuments: total,
      processedDocuments: processed,
      percent: total > 0 ? Math.round((processed / total) * 100) : 0,
      checkpoint: (build.checkpoint as Record<string, unknown> | null) ?? null,
      statistics: (build.statistics as Record<string, unknown> | null) ?? null,
      error: build.error,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      updatedAt: build.updatedAt,
      heartbeatAt: build.heartbeatAt,
    };
  }
}

const triggerActor = (triggeredBy?: string | null): string =>
  triggeredBy || 'system';
