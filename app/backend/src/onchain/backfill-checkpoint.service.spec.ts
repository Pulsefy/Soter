import { Test, TestingModule } from '@nestjs/testing';
import {
  BackfillCheckpointService,
  buildJobKey,
} from './backfill-checkpoint.service';
import { PrismaService } from '../prisma/prisma.service';

const mockCheckpoint = {
  id: 'ckpt-1',
  jobKey: 'backfill:1000:2000',
  startLedger: 1000,
  endLedger: 2000,
  lastProcessedLedger: 999,
  status: 'pending',
  processedCount: 0,
  errorCount: 0,
  campaignId: null,
  batchSize: 100,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('buildJobKey', () => {
  it('builds key without campaignId', () => {
    expect(buildJobKey(1000, 2000)).toBe('backfill:1000:2000');
  });

  it('builds key with campaignId', () => {
    expect(buildJobKey(1000, 2000, 'camp-abc')).toBe(
      'backfill:1000:2000:camp-abc',
    );
  });
});

describe('BackfillCheckpointService', () => {
  let service: BackfillCheckpointService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrisma = {
    backfillCheckpoint: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackfillCheckpointService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BackfillCheckpointService>(BackfillCheckpointService);
    prisma = module.get(PrismaService);

    jest.clearAllMocks();
  });

  describe('initCheckpoint', () => {
    it('returns existing checkpoint without creating a new one', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(
        mockCheckpoint,
      );

      const result = await service.initCheckpoint(1000, 2000, 100);

      expect(result).toEqual(mockCheckpoint);
      expect(mockPrisma.backfillCheckpoint.create).not.toHaveBeenCalled();
    });

    it('creates a new checkpoint when none exists', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.backfillCheckpoint.create.mockResolvedValue({
        ...mockCheckpoint,
        lastProcessedLedger: 999, // startLedger - 1
      });

      const result = await service.initCheckpoint(1000, 2000, 100);

      expect(mockPrisma.backfillCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobKey: 'backfill:1000:2000',
          startLedger: 1000,
          endLedger: 2000,
          lastProcessedLedger: 999,
          status: 'pending',
          batchSize: 100,
          campaignId: null,
        }),
      });
      expect(result.lastProcessedLedger).toBe(999);
    });

    it('sets campaignId when provided', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.backfillCheckpoint.create.mockResolvedValue({
        ...mockCheckpoint,
        jobKey: 'backfill:1000:2000:camp-abc',
        campaignId: 'camp-abc',
      });

      await service.initCheckpoint(1000, 2000, 100, 'camp-abc');

      expect(mockPrisma.backfillCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobKey: 'backfill:1000:2000:camp-abc',
          campaignId: 'camp-abc',
        }),
      });
    });
  });

  describe('markRunning', () => {
    it('updates status to running', async () => {
      const updated = { ...mockCheckpoint, status: 'running' };
      mockPrisma.backfillCheckpoint.update.mockResolvedValue(updated);

      const result = await service.markRunning('backfill:1000:2000');

      expect(mockPrisma.backfillCheckpoint.update).toHaveBeenCalledWith({
        where: { jobKey: 'backfill:1000:2000' },
        data: { status: 'running' },
      });
      expect(result.status).toBe('running');
    });
  });

  describe('advanceCheckpoint', () => {
    it('advances lastProcessedLedger and increments counters', async () => {
      const current = { ...mockCheckpoint, processedCount: 50, errorCount: 2 };
      mockPrisma.backfillCheckpoint.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({
        ...current,
        lastProcessedLedger: 1099,
        processedCount: 60,
        errorCount: 3,
      });

      const result = await service.advanceCheckpoint(
        'backfill:1000:2000',
        1099,
        10,
        1,
      );

      expect(mockPrisma.backfillCheckpoint.update).toHaveBeenCalledWith({
        where: { jobKey: 'backfill:1000:2000' },
        data: {
          lastProcessedLedger: 1099,
          processedCount: 60, // 50 + 10
          errorCount: 3,      // 2 + 1
        },
      });
      expect(result.lastProcessedLedger).toBe(1099);
    });
  });

  describe('markCompleted', () => {
    it('sets status to completed', async () => {
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({
        ...mockCheckpoint,
        status: 'completed',
      });

      const result = await service.markCompleted('backfill:1000:2000');

      expect(result.status).toBe('completed');
    });
  });

  describe('markFailed', () => {
    it('sets status to failed with error message', async () => {
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({
        ...mockCheckpoint,
        status: 'failed',
        lastError: 'RPC timeout',
      });

      const result = await service.markFailed(
        'backfill:1000:2000',
        'RPC timeout',
      );

      expect(result.status).toBe('failed');
      expect(mockPrisma.backfillCheckpoint.update).toHaveBeenCalledWith({
        where: { jobKey: 'backfill:1000:2000' },
        data: {
          status: 'failed',
          lastError: 'RPC timeout',
        },
      });
    });

    it('truncates very long error messages to 1000 chars', async () => {
      const longError = 'x'.repeat(1500);
      mockPrisma.backfillCheckpoint.update.mockResolvedValue({
        ...mockCheckpoint,
        status: 'failed',
        lastError: longError.slice(0, 1000),
      });

      await service.markFailed('backfill:1000:2000', longError);

      const callArgs = mockPrisma.backfillCheckpoint.update.mock.calls[0][0];
      expect(callArgs.data.lastError.length).toBe(1000);
    });
  });

  describe('getCheckpoint', () => {
    it('returns null when not found', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(null);

      const result = await service.getCheckpoint('nonexistent');
      expect(result).toBeNull();
    });

    it('returns checkpoint when found', async () => {
      mockPrisma.backfillCheckpoint.findUnique.mockResolvedValue(mockCheckpoint);

      const result = await service.getCheckpoint('backfill:1000:2000');
      expect(result).toEqual(mockCheckpoint);
    });
  });

  describe('listCheckpoints', () => {
    it('queries with status and campaignId filters', async () => {
      mockPrisma.backfillCheckpoint.findMany.mockResolvedValue([mockCheckpoint]);

      await service.listCheckpoints({ status: 'running', campaignId: 'camp-1', limit: 10 });

      expect(mockPrisma.backfillCheckpoint.findMany).toHaveBeenCalledWith({
        where: { status: 'running', campaignId: 'camp-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('uses default limit of 50', async () => {
      mockPrisma.backfillCheckpoint.findMany.mockResolvedValue([]);

      await service.listCheckpoints();

      expect(mockPrisma.backfillCheckpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('deleteCheckpoint', () => {
    it('deletes by jobKey', async () => {
      mockPrisma.backfillCheckpoint.delete.mockResolvedValue(mockCheckpoint);

      await service.deleteCheckpoint('backfill:1000:2000');

      expect(mockPrisma.backfillCheckpoint.delete).toHaveBeenCalledWith({
        where: { jobKey: 'backfill:1000:2000' },
      });
    });

    it('does not throw when record not found', async () => {
      mockPrisma.backfillCheckpoint.delete.mockRejectedValue(
        new Error('Record not found'),
      );

      await expect(
        service.deleteCheckpoint('nonexistent'),
      ).resolves.not.toThrow();
    });
  });
});
