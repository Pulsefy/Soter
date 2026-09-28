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
