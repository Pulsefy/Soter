import { ConflictException, NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DryRunResult, LedgerBackfillService } from './ledger-backfill.service';
import { StellarLedgerSource } from './stellar-ledger-source';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const mockQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
};

const mockPrisma = {
  backfillCheckpoint: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  balanceLedger: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

const mockLedgerSource = {
  isEnabled: jest.fn(),
  fetchLedgerEntries: jest.fn(),
  describeUnavailable: jest.fn(),
  sourceKind: 'soroban-rpc' as const,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckpoint(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'ckp_001',
    jobKey: 'backfill:1000:2000',
    startLedger: 1000,
    endLedger: 2000,
    lastProcessedLedger: 1000,
    status: 'running',
    campaignId: null,
    batchSize: 100,
    processedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    lastError: null,
    triggeredBy: null,
    startedAt: new Date(),
    completedAt: null,
    heartbeatAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A normalised on-chain movement as `StellarLedgerSource` would return one. */
function makeEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'e1',
    ledger: 1,
    amount: 1000,
    eventType: 'disburse',
    packageId: 'pkg_testnet',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    txHash: 'abc123',
    eventIndex: 0,
    source: 'soroban-rpc',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LedgerBackfillService', () => {
  let service: LedgerBackfillService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // The service refuses to run without a live on-chain source, so the
    // default stub is a configured one.
    mockLedgerSource.isEnabled.mockReturnValue(true);
    mockLedgerSource.fetchLedgerEntries.mockResolvedValue([]);
    mockLedgerSource.describeUnavailable.mockReturnValue(
      'no on-chain source configured',
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerBackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('onchain'), useValue: mockQueue },
        { provide: StellarLedgerSource, useValue: mockLedgerSource },
      ],
    }).compile();

    service = module.get<LedgerBackfillService>(LedgerBackfillService);
  });

  // ── triggerBackfill ────────────────────────────────────────────────────────

  describe('triggerBackfill', () => {
    it('refuses to enqueue when no live on-chain source is configured', async () => {
      mockLedgerSource.isEnabled.mockReturnValue(false);

      await expect(service.triggerBackfill(1000, 2000)).rejects.toThrow(
        NotImplementedException,
      );
      expect(mockPrisma.backfillCheckpoint.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('creates a checkpoint and enqueues the job for a fresh range', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(null);
      const checkpoint = makeCheckpoint({ status: 'running' });
      mockPrisma.backfillCheckpoint.create.mockResolvedValue(checkpoint);
      mockQueue.add.mockResolvedValue({ id: 'job_001' });

      const result = await service.triggerBackfill(1000, 2000, undefined, 100);

      expect(mockPrisma.backfillCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobKey: 'backfill:1000:2000',
            startLedger: 1000,
            endLedger: 2000,
            status: 'running',
          }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'ledger-backfill',
        expect.objectContaining({
          startLedger: 1000,
          endLedger: 2000,
          checkpointId: checkpoint.id,
        }),
        expect.any(Object),
      );
      expect(result.status).toBe('queued');
      expect(result.checkpointId).toBe(checkpoint.id);
      expect(result.jobKey).toBe('backfill:1000:2000');
    });

    it('throws ConflictException when a running checkpoint exists', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(
        makeCheckpoint({ status: 'running' }),
      );

      await expect(service.triggerBackfill(1000, 2000)).rejects.toThrow(
        ConflictException,
      );
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('resumes from lastProcessedLedger when checkpoint is failed', async () => {
      const existing = makeCheckpoint({
        status: 'failed',
        lastProcessedLedger: 1450,
        processedCount: 450,
      });
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, status: 'running' };
      mockPrisma.backfillCheckpoint.update.mockResolvedValue(updated);
      mockQueue.add.mockResolvedValue({ id: 'job_002' });

      const result = await service.triggerBackfill(1000, 2000);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'ledger-backfill',
        expect.objectContaining({ startLedger: 1450, endLedger: 2000 }),
        expect.any(Object),
      );
      expect(result.resumeFrom).toBe(1450);
      expect(result.processedCount).toBe(450);
    });

    it('returns completed result immediately when checkpoint is already completed', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(
        makeCheckpoint({ status: 'completed', processedCount: 1001 }),
      );

      const result = await service.triggerBackfill(1000, 2000);

      expect(result.status).toBe('completed');
      expect(result.processedCount).toBe(1001);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── triggerBackfill (dryRun) ───────────────────────────────────────────────

  describe('triggerBackfill with dryRun', () => {
    it('reports what would happen without creating a checkpoint or enqueuing a job', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);

      const result = await service.triggerBackfill(
        1000,
        2000,
        undefined,
        100,
        undefined,
        true,
      );

      expect(mockPrisma.backfillCheckpoint.create).not.toHaveBeenCalled();
      expect(mockPrisma.backfillCheckpoint.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.balanceLedger.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        dryRun: true,
        jobKey: 'backfill:1000:2000',
        startLedger: 1000,
        endLedger: 2000,
        totalCount: 1001,
      });
    });

    it('reuses the same detection logic as a real run to compute counts and a sample', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([{ id: 'led_1' }]);
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ id: 'led_1', eventType: 'lock', amount: 100 }),
        makeEntry({ id: 'led_2', eventType: 'disburse', amount: 50 }),
      ]);

      const result = (await service.triggerBackfill(
        1,
        1,
        'camp_1',
        100,
        undefined,
        true,
      )) as DryRunResult;

      expect(mockPrisma.balanceLedger.create).not.toHaveBeenCalled();
      expect(result.wouldCreateCount).toBe(1);
      expect(result.wouldSkipCount).toBe(1);
      expect(result.unattributableCount).toBe(0);
      expect(result.byEntityType).toEqual({
        lock: { toCreate: 0, toSkip: 1, unattributable: 0 },
        disburse: { toCreate: 1, toSkip: 0, unattributable: 0 },
      });
      expect(result.sample).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'led_1', action: 'skip' }),
          expect.objectContaining({
            id: 'led_2',
            action: 'create',
            txHash: 'abc123',
          }),
        ]),
      );
    });

    it('flags entries a real run would refuse to store when no campaignId is given', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ id: 'led_3' }),
      ]);

      const result = (await service.triggerBackfill(
        1,
        1,
        undefined,
        100,
        undefined,
        true,
      )) as DryRunResult;

      expect(result.wouldCreateCount).toBe(0);
      expect(result.unattributableCount).toBe(1);
      expect(result.sample[0]).toMatchObject({
        id: 'led_3',
        action: 'unattributable',
      });
    });

    it('refuses a dry run when no live on-chain source is configured', async () => {
      mockLedgerSource.isEnabled.mockReturnValue(false);

      await expect(
        service.triggerBackfill(1, 1, 'camp_1', 100, undefined, true),
      ).rejects.toThrow(NotImplementedException);
    });
  });

  // ── processBackfillBatch ───────────────────────────────────────────────────

  describe('processBackfillBatch', () => {
    it('persists checkpoint progress after each batch', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});

      await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 3,
        batchSize: 2,
        checkpointId: 'ckp_001',
      });

      // Two batches: [1-2] and [3-3]
      expect(mockPrisma.backfillCheckpoint.update).toHaveBeenCalledTimes(3);
    });

    it('marks checkpoint as completed when no errors occur', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});

      await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        checkpointId: 'ckp_001',
      });

      // Final update should set status to 'completed'.
      const lastCall =
        mockPrisma.backfillCheckpoint.update.mock.calls[
          mockPrisma.backfillCheckpoint.update.mock.calls.length - 1
        ];
      expect(lastCall[0].data).toMatchObject({ status: 'completed' });
    });

    it('marks checkpoint as failed when a batch throws', async () => {
      // findMany throws on the first call to simulate a batch failure.
      mockPrisma.balanceLedger.findMany.mockRejectedValue(new Error('DB down'));
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});

      const result = await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        checkpointId: 'ckp_001',
      });

      expect(result.errors).toHaveLength(1);
      const lastCall =
        mockPrisma.backfillCheckpoint.update.mock.calls[
          mockPrisma.backfillCheckpoint.update.mock.calls.length - 1
        ];
      expect(lastCall[0].data).toMatchObject({ status: 'failed' });
    });
  });

  // ── live on-chain source ───────────────────────────────────────────────────

  describe('live on-chain source', () => {
    it('reads the range from the shared Stellar client and persists the rows', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockPrisma.balanceLedger.create.mockResolvedValue({});
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ id: 'e1', amount: 1000 }),
        makeEntry({ id: 'e2', amount: 2500 }),
      ]);

      const result = await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        campaignId: 'cmp_1',
        checkpointId: 'ckp_001',
      });

      expect(mockLedgerSource.fetchLedgerEntries).toHaveBeenCalledWith({
        startLedger: 1,
        endLedger: 1,
      });
      expect(mockPrisma.balanceLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'e1',
          campaignId: 'cmp_1',
          eventType: 'disburse',
          amount: 1000,
        }),
      });
      expect(result.processed).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('skips ids already stored so a resumed run stays idempotent', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([{ id: 'e1' }]);
      mockPrisma.balanceLedger.create.mockResolvedValue({});
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ id: 'e1' }),
        makeEntry({ id: 'e2' }),
      ]);

      const result = await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        campaignId: 'cmp_1',
        checkpointId: 'ckp_001',
      });

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('records an error instead of silently skipping when the client cannot read the range', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});
      mockLedgerSource.fetchLedgerEntries.mockRejectedValue(
        new Error('Soroban RPC request failed'),
      );

      const result = await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        campaignId: 'cmp_1',
        checkpointId: 'ckp_001',
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Soroban RPC request failed');
      const lastCall =
        mockPrisma.backfillCheckpoint.update.mock.calls[
          mockPrisma.backfillCheckpoint.update.mock.calls.length - 1
        ];
      expect(lastCall[0].data).toMatchObject({ status: 'failed' });
    });

    it('refuses to store movements that cannot be attributed to a campaign', async () => {
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);
      mockPrisma.balanceLedger.create.mockResolvedValue({});
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ id: 'e1' }),
      ]);

      const result = await service.processBackfillBatch({
        startLedger: 1,
        endLedger: 1,
        batchSize: 100,
        checkpointId: 'ckp_001',
      });

      expect(mockPrisma.balanceLedger.create).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('campaignId');
    });
  });

  // ── cancelBackfill ─────────────────────────────────────────────────────────

  describe('cancelBackfill', () => {
    it('sets checkpoint status to cancelled', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(
        makeCheckpoint({ status: 'running' }),
      );
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({});

      await service.cancelBackfill('ckp_001');

      expect(mockPrisma.backfillCheckpoint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });

    it('throws when checkpoint does not exist', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(null);

      await expect(service.cancelBackfill('missing')).rejects.toThrow(
        'not found',
      );
    });

    it('is a no-op when checkpoint is already completed', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(
        makeCheckpoint({ status: 'completed' }),
      );

      await service.cancelBackfill('ckp_001');

      expect(mockPrisma.backfillCheckpoint.update).not.toHaveBeenCalled();
    });
  });

  // ── listCheckpoints ────────────────────────────────────────────────────────

  describe('listCheckpoints', () => {
    it('returns checkpoints ordered by createdAt desc', async () => {
      const rows = [makeCheckpoint(), makeCheckpoint({ id: 'ckp_002' })];
      mockPrisma.backfillCheckpoint.findMany.mockResolvedValue(rows);

      const result = await service.listCheckpoints(10);

      expect(mockPrisma.backfillCheckpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      );
      expect(result).toHaveLength(2);
    });
  });
});
