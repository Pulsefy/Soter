import { Job } from 'bullmq';
import {
  IDEMPOTENCY_KEY_EXPIRY_SCOPE,
  RetentionPurgeProcessor,
  RetentionPurgeJobData,
} from './retention-purge.processor';
import { RetentionPolicyService } from './retention-policy.service';
import { IdempotencyKeyRetentionService } from './idempotency-key-retention.service';
import { MetricsService } from '../observability/metrics/metrics.service';

function makeJob(
  data: Partial<RetentionPurgeJobData>,
): Job<RetentionPurgeJobData> {
  return {
    id: 'job-1',
    data: {
      triggeredBy: 'cron',
      timestamp: Date.now(),
      ...data,
    },
  } as unknown as Job<RetentionPurgeJobData>;
}

describe('RetentionPurgeProcessor', () => {
  let retentionService: { executePurge: jest.Mock };
  let idempotencyService: { purgeExpiredKeys: jest.Mock };
  let metrics: {
    recordIdempotencyPurgeRun: jest.Mock;
    recordIdempotencyPurgeFailure: jest.Mock;
  };
  let processor: RetentionPurgeProcessor;

  beforeEach(() => {
    retentionService = {
      executePurge: jest.fn().mockResolvedValue([
        {
          entity: 'AuditLog',
          strategy: 'soft_delete',
          affected: 5,
          cutoffDate: new Date(),
        },
      ]),
    };
    idempotencyService = {
      purgeExpiredKeys: jest.fn().mockResolvedValue({
        batchesRun: 2,
        recordsPurged: 40,
        startedAt: new Date(),
        completedAt: new Date(),
      }),
    };
    metrics = {
      recordIdempotencyPurgeRun: jest.fn(),
      recordIdempotencyPurgeFailure: jest.fn(),
    };

    processor = new RetentionPurgeProcessor(
      retentionService as unknown as RetentionPolicyService,
      idempotencyService as unknown as IdempotencyKeyRetentionService,
      metrics as unknown as MetricsService,
    );
  });

  it('runs the entity policy purge for jobs without a scope', async () => {
    await processor.process(makeJob({}));

    expect(retentionService.executePurge).toHaveBeenCalledTimes(1);
    expect(idempotencyService.purgeExpiredKeys).not.toHaveBeenCalled();
    expect(metrics.recordIdempotencyPurgeRun).not.toHaveBeenCalled();
  });

  it('purges expired idempotency keys for the idempotency-key-expiry scope', async () => {
    await processor.process(makeJob({ scope: IDEMPOTENCY_KEY_EXPIRY_SCOPE }));

    expect(idempotencyService.purgeExpiredKeys).toHaveBeenCalledTimes(1);
    expect(retentionService.executePurge).not.toHaveBeenCalled();
    expect(metrics.recordIdempotencyPurgeRun).toHaveBeenCalledWith('success');
  });

  it('re-throws entity policy purge errors so BullMQ marks the job failed', async () => {
    retentionService.executePurge.mockRejectedValue(
      new Error('policy purge failed'),
    );

    await expect(processor.process(makeJob({}))).rejects.toThrow(
      'policy purge failed',
    );
    expect(metrics.recordIdempotencyPurgeRun).not.toHaveBeenCalled();
  });

  it('emits failure metrics and re-throws when the idempotency purge fails', async () => {
    idempotencyService.purgeExpiredKeys.mockRejectedValue(
      new Error('db timeout'),
    );

    await expect(
      processor.process(makeJob({ scope: IDEMPOTENCY_KEY_EXPIRY_SCOPE })),
    ).rejects.toThrow('db timeout');

    expect(metrics.recordIdempotencyPurgeRun).toHaveBeenCalledWith('failed');
    expect(metrics.recordIdempotencyPurgeFailure).toHaveBeenCalledWith(
      'db timeout',
    );
  });
});
