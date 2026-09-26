import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { LedgerBackfillService, BackfillJobData } from './ledger-backfill.service';
import {
  BackfillCheckpointService,
  CheckpointData,
} from './backfill-checkpoint.service';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';
import { MetricsService } from '../observability/metrics/metrics.service';

const makeCheckpoint = (overrides: Partial<CheckpointData> = {}): CheckpointData => ({
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
  ...overrides,
});

describe('LedgerBackfillService', () => {
  let service: LedgerBackfillService;
  let checkpointService: jest.Mocked<BackfillCheckpointService>;
  let correlationService: jest.Mocked<SorobanEventCorrelationService>;
  let metricsService: jest.Mocked<MetricsService>;
  let mockQueue: jest.Mocked<any>;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'backfill:1000:2000' }),
      getJob: jest.fn(),
    };

    const mockCheckpointService = {
      initCheckpoint: jest.fn(),
      markRunning: jest.fn(),
      advanceCheckpoint: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
      getCheckpoint: jest.fn(),
      listCheckpoints: jest.fn(),
    };

    const mockCorrelationService = {
      correlateEvents: jest.fn(),
    };

    const mockMetricsService = {
      incrementCounter: jest.fn(),
      setGauge: jest.fn(),
      recordHistogram: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerBackfillService,
        { provide: BackfillCheckpointService, useValue: mockCheckpointService },
        { provide: SorobanEventCorrelationService, useValue: mockCorrelationService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: getQueueToken('ledger-backfill'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<LedgerBackfillService>(LedgerBackfillService);
    checkpointService = module.get(BackfillCheckpointService);
    correlationService = module.get(SorobanEventCorrelationService);
    metricsService = module.get(MetricsService);

    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // triggerBackfill
  // ──────────────────────────────────────────────────────────────────────────

  describe('triggerBackfill', () => {
    it('creates checkpoint and enqueues BullMQ job', async () => {
      const ckpt = makeCheckpoint();
      checkpointService.initCheckpoint.mockResolvedValue(ckpt);

      const result = await service.triggerBackfill(1000, 2000, undefined, 100);

      expect(checkpointService.initCheckpoint).toHaveBeenCalledWith(
        1000,
        2000,
        100,
        undefined,
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-backfill',
        expect.objectContaining({
          startLedger: 1000,
          endLedger: 2000,
          jobKey: 'backfill:1000:2000',
          batchSize: 100,
        }),
        expect.objectContaining({ jobId: 'backfill:1000:2000' }),
      );
      expect(result.status).toBe('queued');
      expect(result.totalLedgers).toBe(1001);
    });

    it('returns existing checkpoint processedCount for resumed jobs', async () => {
      const ckpt = makeCheckpoint({ processedCount: 500, lastProcessedLedger: 1499 });
      checkpointService.initCheckpoint.mockResolvedValue(ckpt);

      const result = await service.triggerBackfill(1000, 2000);

      expect(result.processedCount).toBe(500);
      expect(result.lastProcessedLedger).toBe(1499);
    });

    it('emits a trigger metric', async () => {
      checkpointService.initCheckpoint.mockResolvedValue(makeCheckpoint());

      await service.triggerBackfill(1000, 2000, 'camp-1');

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'backfill_jobs_triggered_total',
        { campaign_id: 'camp-1' },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getBackfillStatus
  // ──────────────────────────────────────────────────────────────────────────

  describe('getBackfillStatus', () => {
    it('returns null when checkpoint not found', async () => {
      checkpointService.getCheckpoint.mockResolvedValue(null);
      mockQueue.getJob.mockResolvedValue(null);

      const result = await service.getBackfillStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('maps checkpoint status to result status', async () => {
      const ckpt = makeCheckpoint({ status: 'completed', processedCount: 1001 });
      checkpointService.getCheckpoint.mockResolvedValue(ckpt);

      const result = await service.getBackfillStatus('backfill:1000:2000');

      expect(result?.status).toBe('completed');
      expect(result?.processedCount).toBe(1001);
    });

    it('maps running to processing', async () => {
      const ckpt = makeCheckpoint({ status: 'running' });
      checkpointService.getCheckpoint.mockResolvedValue(ckpt);

      const result = await service.getBackfillStatus('backfill:1000:2000');
      expect(result?.status).toBe('processing');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // executeBackfill
  // ──────────────────────────────────────────────────────────────────────────

  describe('executeBackfill', () => {
    const jobData: BackfillJobData = {
      startLedger: 1000,
      endLedger: 1199,
      batchSize: 100,
      jobKey: 'backfill:1000:1199',
    };

    beforeEach(() => {
      checkpointService.markRunning.mockResolvedValue(
        makeCheckpoint({ jobKey: jobData.jobKey, startLedger: 1000, endLedger: 1199, lastProcessedLedger: 999 }),
      );
      checkpointService.advanceCheckpoint.mockResolvedValue(
        makeCheckpoint({ jobKey: jobData.jobKey }),
      );
      checkpointService.markCompleted.mockResolvedValue(
        makeCheckpoint({ jobKey: jobData.jobKey, status: 'completed' }),
      );
    });

    it('processes all batches and marks completed', async () => {
      correlationService.correlateEvents
        .mockResolvedValueOnce({ correlated: 10, skipped: 0, errors: 0, details: [] })
        .mockResolvedValueOnce({ correlated: 12, skipped: 1, errors: 0, details: [] });

      const result = await service.executeBackfill(jobData);

      expect(correlationService.correlateEvents).toHaveBeenCalledTimes(2);
      expect(result.processed).toBe(22);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(checkpointService.markCompleted).toHaveBeenCalledWith(jobData.jobKey);
    });

    it('resumes from lastProcessedLedger when checkpoint is ahead', async () => {
      checkpointService.markRunning.mockResolvedValue(
        makeCheckpoint({
          jobKey: jobData.jobKey,
          startLedger: 1000,
          endLedger: 1199,
          lastProcessedLedger: 1099, // first batch already done
        }),
      );
      correlationService.correlateEvents.mockResolvedValue({
        correlated: 5,
        skipped: 0,
        errors: 0,
        details: [],
      });

      await service.executeBackfill(jobData);

      // Only one batch (1100-1199) should be called
      expect(correlationService.correlateEvents).toHaveBeenCalledTimes(1);
      expect(correlationService.correlateEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 1100, endLedger: 1199 }),
      );
    });

    it('saves checkpoint after each successful batch', async () => {
      correlationService.correlateEvents
        .mockResolvedValueOnce({ correlated: 5, skipped: 0, errors: 0, details: [] })
        .mockResolvedValueOnce({ correlated: 3, skipped: 0, errors: 0, details: [] });

      await service.executeBackfill(jobData);

      expect(checkpointService.advanceCheckpoint).toHaveBeenCalledTimes(2);
      expect(checkpointService.advanceCheckpoint).toHaveBeenNthCalledWith(
        1,
        jobData.jobKey,
        1099, // batchEnd of first batch
        5,
        0,
      );
    });

    it('rethrows error so BullMQ can retry', async () => {
      correlationService.correlateEvents.mockRejectedValueOnce(
        new Error('RPC connection refused'),
      );

      await expect(service.executeBackfill(jobData)).rejects.toThrow(
        'RPC connection refused',
      );
    });

    it('calls onProgress callback with percentage', async () => {
      correlationService.correlateEvents
        .mockResolvedValueOnce({ correlated: 5, skipped: 0, errors: 0, details: [] })
        .mockResolvedValueOnce({ correlated: 5, skipped: 0, errors: 0, details: [] });

      const progressCalls: Array<[number, string]> = [];
      const onProgress = jest.fn(async (pct: number, msg: string) => {
        progressCalls.push([pct, msg]);
      });

      await service.executeBackfill(jobData, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(progressCalls[0][0]).toBe(50);  // first batch = 50%
      expect(progressCalls[1][0]).toBe(100); // second batch = 100%
    });

    it('emits progress gauge metric', async () => {
      correlationService.correlateEvents.mockResolvedValue({
        correlated: 5,
        skipped: 0,
        errors: 0,
        details: [],
      });

      await service.executeBackfill(jobData);

      expect(metricsService.setGauge).toHaveBeenCalledWith(
        'backfill_progress',
        100,
        { job_key: jobData.jobKey },
      );
    });

    it('records duration histogram on completion', async () => {
      correlationService.correlateEvents.mockResolvedValue({
        correlated: 1,
        skipped: 0,
        errors: 0,
        details: [],
      });

      await service.executeBackfill(jobData);

      expect(metricsService.recordHistogram).toHaveBeenCalledWith(
        'backfill_duration_seconds',
        expect.any(Number),
        { campaign_id: 'none' },
      );
    });
  });
});
