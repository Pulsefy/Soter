import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SearchIndexService } from './search-index.service';
import { SEARCH_INDEX_BUILD_MODE_DRY_RUN } from './search-index.constants';

interface BuildRow {
  id: string;
  status: string;
  mode: string;
  entityTypes: string[];
  batchSize: number;
  triggeredBy: string | null;
  totalDocuments: number;
  processedDocuments: number;
  checkpoint: Record<string, unknown> | null;
  statistics: Record<string, unknown> | null;
  error: string | null;
  heartbeatAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EntryRow {
  id: string;
  entityType: string;
  entityId: string;
  orgId: string;
  label: string;
  status: string;
  searchText: string;
  buildId: string;
}

function makeMock() {
  const buildRows: BuildRow[] = [];
  const entryRows: EntryRow[] = [];

  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ locked: true }]),
    searchIndexBuild: {
      findUnique: jest.fn(({ where }: any) => {
        return buildRows.find(b => b.id === where.id) ?? null;
      }),
      findFirst: jest.fn(({ where }: any) => {
        const rows = where?.status
          ? buildRows.filter(b => b.status === where.status)
          : [...buildRows];
        return rows[rows.length - 1] ?? null;
      }),
      create: jest.fn(({ data }: any) => {
        const row: BuildRow = {
          id: `build-${buildRows.length + 1}`,
          status: 'running',
          mode: 'rebuild',
          entityTypes: ['campaign', 'claim', 'recipient', 'verification'],
          batchSize: 100,
          triggeredBy: null,
          totalDocuments: 0,
          processedDocuments: 0,
          checkpoint: null,
          statistics: null,
          error: null,
          heartbeatAt: null,
          startedAt: new Date(),
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        buildRows.push(row);
        return row;
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = buildRows.find(b => b.id === where.id);
        if (!row) throw new Error(`build ${where.id} not found`);
        Object.assign(row, data);
        return row;
      }),
    },
    searchIndexEntry: {
      upsert: jest.fn(({ create }: any) => {
        const existing = entryRows.find(
          e =>
            e.entityType === create.entityType &&
            e.entityId === create.entityId &&
            e.orgId === create.orgId,
        );
        if (existing) {
          Object.assign(existing, create, { id: existing.id });
          return existing;
        }
        const entry: EntryRow = {
          id: `entry-${entryRows.length + 1}`,
          entityType: create.entityType,
          entityId: create.entityId,
          orgId: create.orgId,
          label: create.label,
          status: create.status,
          searchText: create.searchText,
          buildId: create.buildId,
        };
        entryRows.push(entry);
        return entry;
      }),
      deleteMany: jest.fn(({ where }: any) => {
        const before = entryRows.length;
        for (let i = entryRows.length - 1; i >= 0; i--) {
          const e = entryRows[i];
          if (
            e.entityType === where.entityType &&
            e.buildId !== where.buildId.not
          ) {
            entryRows.splice(i, 1);
          }
        }
        return { count: before - entryRows.length };
      }),
      count: jest.fn(() => entryRows.length),
    },
    campaign: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    claim: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    verificationSession: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  return { prisma, buildRows, entryRows };
}

const auditMock = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };

async function makeService() {
  const { prisma, buildRows, entryRows } = makeMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SearchIndexService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: auditMock },
    ],
  }).compile();

  const service = module.get<SearchIndexService>(SearchIndexService);
  return { service, prisma, buildRows, entryRows };
}

describe('SearchIndexService', () => {
  let service: SearchIndexService;
  let prisma: any;
  let buildRows: BuildRow[];
  let entryRows: EntryRow[];

  const baseCounts = { campaign: 3, claim: 4, recipient: 5, verification: 2 };

  beforeEach(async () => {
    jest.clearAllMocks();
    const ctx = await makeService();
    service = ctx.service;
    prisma = ctx.prisma;
    buildRows = ctx.buildRows;
    entryRows = ctx.entryRows;

    prisma.campaign.count.mockResolvedValue(baseCounts.campaign);
    prisma.claim.count.mockResolvedValue(baseCounts.claim);
    prisma.verificationSession.count.mockResolvedValue(baseCounts.verification);
    prisma.claim.groupBy.mockResolvedValue(
      Array.from({ length: baseCounts.recipient }, (_, i) => ({
        recipientRef: `recipient-${i}`,
      })),
    );

    prisma.campaign.findMany.mockResolvedValue([]);
    prisma.claim.findMany.mockResolvedValue([]);
    prisma.verificationSession.findMany.mockResolvedValue([]);
  });

  describe('dry run', () => {
    it('reports document counts without mutating the index', async () => {
      const progress = await service.startRebuild({ dryRun: true });

      expect(progress.status).toBe('completed');
      expect(progress.mode).toBe(SEARCH_INDEX_BUILD_MODE_DRY_RUN);
      expect(progress.totalDocuments).toBe(
        baseCounts.campaign +
          baseCounts.claim +
          baseCounts.recipient +
          baseCounts.verification,
      );
      expect(progress.statistics).toEqual({
        counts: baseCounts,
      });
      expect(prisma.searchIndexEntry.upsert).not.toHaveBeenCalled();
      expect(prisma.searchIndexEntry.deleteMany).not.toHaveBeenCalled();
      expect(entryRows).toHaveLength(0);
      expect(prisma.campaign.count).toHaveBeenCalled();
      expect(prisma.claim.groupBy).toHaveBeenCalled();
    });

    it('releases the in-process claim so a follow-up rebuild is allowed', async () => {
      await service.startRebuild({ dryRun: true });
      await service.startRebuild({ dryRun: true });
      expect(buildRows).toHaveLength(2);
    });
  });

  describe('full rebuild', () => {
    it('indexes all documents in bounded batches and completes', async () => {
      const campaignRows = Array.from({ length: 12 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `Campaign ${i + 1}`,
        status: 'active',
        orgId: 'org-1',
      }));
      prisma.campaign.findMany.mockImplementation((args: any) => {
        const startIdx = args.cursor
          ? campaignRows.findIndex(r => r.id === args.cursor.id) + 1
          : 0;
        return Promise.resolve(
          campaignRows.slice(startIdx, startIdx + args.take),
        );
      });

      const progress = await service.startRebuild({ batchSize: 10 });
      await service.waitForBuild(progress.id);

      // 2 populated batches of 10 + 2, then 1 empty terminator scan
      expect(prisma.campaign.findMany).toHaveBeenCalledTimes(3);
      expect(prisma.searchIndexEntry.upsert).toHaveBeenCalledTimes(12);
      expect(entryRows.map(e => e.entityId)).toEqual(
        campaignRows.map(r => r.id),
      );

      const build = buildRows.find(b => b.id === progress.id);
      expect(build?.status).toBe('completed');
      expect(build?.processedDocuments).toBe(12);
      expect(build?.completedAt).not.toBeNull();
      expect(prisma.searchIndexEntry.deleteMany).toHaveBeenCalled();
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'completed', entityId: progress.id }),
      );
    });

    it('skips documents without an org scope', async () => {
      const campaignRows = [
        { id: 'c1', name: 'Food Aid', status: 'active', orgId: 'org-1' },
        {
          id: 'c2',
          name: 'Unscoped',
          status: 'active',
          orgId: null,
          ngoId: null,
        },
      ];
      prisma.campaign.findMany.mockImplementation((args: any) => {
        const startIdx = args.cursor
          ? campaignRows.findIndex(r => r.id === args.cursor.id) + 1
          : 0;
        return Promise.resolve(
          campaignRows.slice(startIdx, startIdx + args.take),
        );
      });

      const progress = await service.startRebuild({ batchSize: 100 });
      await service.waitForBuild(progress.id);

      expect(entryRows.map(e => e.entityId)).toEqual(['c1']);
    });
  });

  describe('concurrency', () => {
    it('rejects a concurrent rebuild request while one is running', async () => {
      let release: ((value: unknown) => void) | undefined;
      prisma.campaign.findMany.mockReturnValue(
        new Promise(resolve => {
          release = resolve;
        }),
      );

      const progress = await service.startRebuild({});

      await expect(service.startRebuild({})).rejects.toBeInstanceOf(
        ConflictException,
      );

      release?.([]);
      await service.waitForBuild(progress.id);
    });

    it('rejects a rebuild when another instance owns a fresh running build', async () => {
      buildRows.push({
        id: 'other-instance-build',
        status: 'running',
        mode: 'rebuild',
        entityTypes: ['campaign'],
        batchSize: 100,
        triggeredBy: null,
        totalDocuments: 0,
        processedDocuments: 0,
        checkpoint: null,
        statistics: null,
        error: null,
        heartbeatAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.startRebuild({})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(buildRows).toHaveLength(1);
    });
  });

  describe('resume', () => {
    const staleRunningBuild = (
      checkpoint: Record<string, unknown> | null,
    ): BuildRow => ({
      id: 'interrupted-build',
      status: 'running',
      mode: 'rebuild',
      entityTypes: ['campaign'],
      batchSize: 100,
      triggeredBy: 'system',
      totalDocuments: 10,
      processedDocuments: 2,
      checkpoint,
      statistics: null,
      error: null,
      heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      completedAt: null,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    it('continues a stale build from its stored checkpoint cursor', async () => {
      const campaignRows = [
        { id: 'c1', name: 'A', status: 'active', orgId: 'org-1' },
        { id: 'c2', name: 'B', status: 'active', orgId: 'org-1' },
        { id: 'c3', name: 'C', status: 'active', orgId: 'org-2' },
      ];
      buildRows.push(
        staleRunningBuild({
          campaign: { cursor: 'c2', done: false },
          claim: { cursor: undefined, done: false },
          recipient: { cursor: undefined, done: false },
          verification: { cursor: undefined, done: false },
        }),
      );
      prisma.campaign.findMany.mockImplementation((args: any) => {
        const startIdx = args.cursor
          ? campaignRows.findIndex(r => r.id === args.cursor?.id) + 1
          : 0;
        return Promise.resolve(
          campaignRows.slice(startIdx, startIdx + args.take),
        );
      });

      const progress = await service.startRebuild({ resume: true });
      expect(progress.id).toBe('interrupted-build');

      await service.waitForBuild('interrupted-build');

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'c2' }, skip: 1 }),
      );
      const build = buildRows.find(b => b.id === 'interrupted-build');
      expect(build?.status).toBe('completed');
      expect(entryRows.map(e => e.entityId)).toEqual(['c3']);
    });

    it('rejects resume when no interrupted build exists', async () => {
      await expect(
        service.startRebuild({ resume: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('stale running build superseded', () => {
    it('marks a stale build as failed and starts a fresh one', async () => {
      buildRows.push({
        id: 'stale-build',
        status: 'running',
        mode: 'rebuild',
        entityTypes: ['campaign'],
        batchSize: 100,
        triggeredBy: null,
        totalDocuments: 0,
        processedDocuments: 5,
        checkpoint: null,
        statistics: null,
        error: null,
        heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const progress = await service.startRebuild({});
      await service.waitForBuild(progress.id);

      expect(buildRows.find(b => b.id === 'stale-build')?.status).toBe(
        'failed',
      );
      expect(buildRows.find(b => b.id === progress.id)?.status).toBe(
        'completed',
      );
    });
  });

  describe('getLatestProgress', () => {
    it('returns the most recent build or null', async () => {
      await service.startRebuild({ dryRun: true });
      const latest = await service.getLatestProgress();
      expect(latest?.id).toBe(buildRows[buildRows.length - 1].id);

      const empty = await makeService();
      expect(await empty.service.getLatestProgress()).toBeNull();
    });
  });
});
