import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { LedgerBackfillService } from './ledger-backfill.service';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LedgerBackfillService', () => {
  let service: LedgerBackfillService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerBackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('onchain'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<LedgerBackfillService>(LedgerBackfillService);
  });

  // ── triggerBackfill ────────────────────────────────────────────────────────

  describe('triggerBackfill', () => {
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
      const existing = { id: 'led_1' };
      mockPrisma.balanceLedger.findMany.mockResolvedValue([existing]);

      // fetchLedgerRange is a private stub returning []; simulate detected
      // entries by spying on it so dry-run and real-run share the same input.
      const fetchSpy = jest
        .spyOn(service as any, 'fetchLedgerRange')
        .mockReturnValue([
          {
            id: 'led_1',
            campaignId: 'camp_1',
            claimId: null,
            eventType: 'lock',
            amount: 100,
            note: null,
            createdAt: new Date(),
          },
          {
            id: 'led_2',
            campaignId: 'camp_1',
            claimId: null,
            eventType: 'disburse',
            amount: 50,
            note: null,
            createdAt: new Date(),
          },
        ]);

      const result = (await service.triggerBackfill(
        1,
        1,
        undefined,
        100,
        undefined,
        true,
      )) as any;

      expect(result.wouldCreateCount).toBe(1);
      expect(result.wouldSkipCount).toBe(1);
      expect(result.byEntityType).toMatchObject({
        lock: { toCreate: 0, toSkip: 1 },
        disburse: { toCreate: 1, toSkip: 0 },
      });
      expect(result.sample).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'led_1', action: 'skip' }),
          expect.objectContaining({ id: 'led_2', action: 'create' }),
        ]),
      );

      fetchSpy.mockRestore();
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
