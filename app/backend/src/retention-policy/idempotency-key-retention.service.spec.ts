import { IdempotencyKeyRetentionService } from './idempotency-key-retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';

function makeIds(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
  }));
}

describe('IdempotencyKeyRetentionService', () => {
  let service: IdempotencyKeyRetentionService;
  let prisma: {
    idempotencyKey: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let metrics: { recordIdempotencyKeysPurged: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      idempotencyKey: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    metrics = { recordIdempotencyKeysPurged: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    service = new IdempotencyKeyRetentionService(
      prisma as unknown as PrismaService,
      metrics as unknown as MetricsService,
      configService as unknown as ConfigService,
    );
  });

  describe('purgeExpiredKeys', () => {
    it('deletes expired records in bounded batches until none remain', async () => {
      prisma.idempotencyKey.findMany
        .mockResolvedValueOnce(makeIds(500))
        .mockResolvedValueOnce(makeIds(500))
        .mockResolvedValueOnce(makeIds(200))
        .mockResolvedValueOnce([]);
      prisma.idempotencyKey.deleteMany.mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve({ count: where.id.in.length }),
      );

      const summary = await service.purgeExpiredKeys();

      // 1200 expired records deleted in batches of 500, 500, 200
      expect(summary).toEqual(
        expect.objectContaining({ batchesRun: 3, recordsPurged: 1200 }),
      );
      expect(summary.startedAt).toBeInstanceOf(Date);
      expect(summary.completedAt).toBeInstanceOf(Date);

      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(3);
      expect(
        prisma.idempotencyKey.deleteMany.mock.calls[0][0].where.id.in,
      ).toHaveLength(500);
      expect(
        prisma.idempotencyKey.deleteMany.mock.calls[2][0].where.id.in,
      ).toHaveLength(200);

      expect(metrics.recordIdempotencyKeysPurged).toHaveBeenNthCalledWith(
        1,
        500,
      );
      expect(metrics.recordIdempotencyKeysPurged).toHaveBeenNthCalledWith(
        2,
        500,
      );
      expect(metrics.recordIdempotencyKeysPurged).toHaveBeenNthCalledWith(
        3,
        200,
      );
    });

    it('queries only expired rows and never loads more than the batch size', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValueOnce([]);

      await service.purgeExpiredKeys();

      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { lte: expect.any(Date) } },
          select: { id: true },
          orderBy: { expiresAt: 'asc' },
          take: 500, // default batch size
        }),
      );
    });

    it('stops after maxBatches even when expired records remain', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValue(makeIds(500));
      prisma.idempotencyKey.deleteMany.mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve({ count: where.id.in.length }),
      );

      const summary = await service.purgeExpiredKeys({ maxBatches: 2 });

      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(2);
      expect(summary).toEqual(
        expect.objectContaining({ batchesRun: 2, recordsPurged: 1000 }),
      );
    });

    it('is a no-op when there are no expired records', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValue([]);

      const summary = await service.purgeExpiredKeys();

      expect(summary).toEqual(
        expect.objectContaining({ batchesRun: 0, recordsPurged: 0 }),
      );
      expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
      expect(metrics.recordIdempotencyKeysPurged).not.toHaveBeenCalled();
    });

    it('uses options overrides instead of configuration', async () => {
      configService.get.mockReturnValue('999'); // would be used if no override
      prisma.idempotencyKey.findMany.mockResolvedValueOnce([]);

      await service.purgeExpiredKeys({ batchSize: 10, maxBatches: 3 });

      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('reads batch size and max batches from configuration when options are not given', async () => {
      configService.get.mockReturnValue('13');
      prisma.idempotencyKey.findMany.mockResolvedValue([]);

      await service.purgeExpiredKeys();

      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 13 }),
      );
    });

    it('does not purge non-expired records', async () => {
      prisma.idempotencyKey.findMany.mockResolvedValueOnce([]);

      await service.purgeExpiredKeys();

      // The where clause restricts to expiresAt <= now, so nothing else can
      // be selected, and deleteMany operates only on the selected ids.
      expect(prisma.idempotencyKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: { lte: expect.any(Date) } },
        }),
      );
    });

    it('propagates database errors so callers can observe the failure', async () => {
      prisma.idempotencyKey.findMany.mockRejectedValue(
        new Error('database unavailable'),
      );

      await expect(service.purgeExpiredKeys()).rejects.toThrow(
        'database unavailable',
      );
      expect(metrics.recordIdempotencyKeysPurged).not.toHaveBeenCalled();
    });

    it('supports repeated cleanup runs without side effects', async () => {
      prisma.idempotencyKey.findMany
        .mockResolvedValueOnce(makeIds(3))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 3 });

      const first = await service.purgeExpiredKeys();
      const second = await service.purgeExpiredKeys();

      expect(first.recordsPurged).toBe(3);
      expect(second.recordsPurged).toBe(0);
      expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
