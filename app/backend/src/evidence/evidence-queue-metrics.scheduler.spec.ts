import { Test, TestingModule } from '@nestjs/testing';
import { EvidenceStatus } from '@prisma/client';
import { EvidenceQueueMetricsScheduler } from './evidence-queue-metrics.scheduler';
import { MetricsService } from '../observability/metrics/metrics.service';

/**
 * Unit tests for EvidenceQueueMetricsScheduler (issue #954).
 *
 * PrismaService and MetricsService are both replaced with Jest mocks so the
 * scheduler logic can be tested in isolation without a real database or
 * Prometheus registry.
 */
describe('EvidenceQueueMetricsScheduler', () => {
  let scheduler: EvidenceQueueMetricsScheduler;

  const mockPrisma = {
    evidenceQueueItem: {
      groupBy: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockMetrics = {
    setEvidenceQueueDepth: jest.fn(),
    setEvidenceQueueOldestPendingAge: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceQueueMetricsScheduler,
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .compile();

    scheduler = module.get<EvidenceQueueMetricsScheduler>(
      EvidenceQueueMetricsScheduler,
    );

    // Replace the private prisma reference with the mock directly so the
    // scheduler uses our stub regardless of DI token naming.
    (scheduler as unknown as Record<string, unknown>)['prisma'] = mockPrisma;
    (scheduler as unknown as Record<string, unknown>)['metrics'] = mockMetrics;
  });

  describe('refreshEvidenceQueueMetrics', () => {
    it('sets queue depth for all statuses using DB counts', async () => {
      mockPrisma.evidenceQueueItem.groupBy.mockResolvedValueOnce([
        { status: EvidenceStatus.pending, _count: { id: 4 } },
        { status: EvidenceStatus.uploading, _count: { id: 1 } },
        { status: EvidenceStatus.completed, _count: { id: 20 } },
        // failed is deliberately missing — should be zero-filled
      ]);
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValueOnce(null);

      await scheduler.refreshEvidenceQueueMetrics();

      expect(mockMetrics.setEvidenceQueueDepth).toHaveBeenCalledWith(
        EvidenceStatus.pending,
        4,
      );
      expect(mockMetrics.setEvidenceQueueDepth).toHaveBeenCalledWith(
        EvidenceStatus.uploading,
        1,
      );
      expect(mockMetrics.setEvidenceQueueDepth).toHaveBeenCalledWith(
        EvidenceStatus.completed,
        20,
      );
      // Zero-fill for missing status
      expect(mockMetrics.setEvidenceQueueDepth).toHaveBeenCalledWith(
        EvidenceStatus.failed,
        0,
      );
    });

    it('sets oldest pending age from the oldest non-terminal item', async () => {
      const createdAt = new Date(Date.now() - 90_000); // 90 seconds ago
      mockPrisma.evidenceQueueItem.groupBy.mockResolvedValueOnce([]);
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValueOnce({
        createdAt,
      });

      await scheduler.refreshEvidenceQueueMetrics();

      const call = mockMetrics.setEvidenceQueueOldestPendingAge.mock.calls[0];
      const reportedAge: number = call[0];

      // Allow ±2 s tolerance for test timing jitter
      expect(reportedAge).toBeGreaterThanOrEqual(88);
      expect(reportedAge).toBeLessThanOrEqual(92);
    });

    it('sets oldest pending age to 0 when there are no non-terminal items', async () => {
      mockPrisma.evidenceQueueItem.groupBy.mockResolvedValueOnce([]);
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValueOnce(null);

      await scheduler.refreshEvidenceQueueMetrics();

      expect(mockMetrics.setEvidenceQueueOldestPendingAge).toHaveBeenCalledWith(
        0,
      );
    });

    it('does not throw when the DB call rejects — logs the error instead', async () => {
      mockPrisma.evidenceQueueItem.groupBy.mockRejectedValueOnce(
        new Error('DB timeout'),
      );
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValueOnce(null);

      // Should not throw
      await expect(
        scheduler.refreshEvidenceQueueMetrics(),
      ).resolves.toBeUndefined();

      // Metrics should not have been set on failure
      expect(mockMetrics.setEvidenceQueueDepth).not.toHaveBeenCalled();
    });
  });
});
