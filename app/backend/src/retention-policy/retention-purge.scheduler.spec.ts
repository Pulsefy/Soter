import { Queue } from 'bullmq';
import {
  IDEMPOTENCY_KEY_EXPIRY_SCOPE,
  RetentionPurgeJobData,
} from './retention-purge.processor';
import { RetentionPurgeScheduler } from './retention-purge.scheduler';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';

describe('RetentionPurgeScheduler', () => {
  let queue: { add: jest.Mock };
  let metrics: { recordIdempotencyPurgeFailure: jest.Mock };
  let scheduler: RetentionPurgeScheduler;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    metrics = { recordIdempotencyPurgeFailure: jest.fn() };

    scheduler = new RetentionPurgeScheduler(
      queue as unknown as Queue<RetentionPurgeJobData>,
      { get: jest.fn() } as unknown as ConfigService,
      metrics as unknown as MetricsService,
    );
  });

  it('enqueues an idempotency key expiry purge job when the cron fires', async () => {
    await scheduler.scheduleIdempotencyKeyExpiryPurge();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      IDEMPOTENCY_KEY_EXPIRY_SCOPE,
      expect.objectContaining({
        scope: IDEMPOTENCY_KEY_EXPIRY_SCOPE,
        triggeredBy: 'cron',
        timestamp: expect.any(Number),
      }),
      expect.objectContaining({ attempts: 2 }),
    );
  });

  it('skips scheduling when a previous run is still in flight', async () => {
    let resolveAdd!: (value: { id: string }) => void;
    queue.add.mockReturnValueOnce(
      new Promise(resolve => {
        resolveAdd = resolve;
      }),
    );

    const first = scheduler.scheduleIdempotencyKeyExpiryPurge();
    const second = scheduler.scheduleIdempotencyKeyExpiryPurge();

    resolveAdd({ id: 'job-1' });
    await Promise.all([first, second]);

    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('does not throw when enqueueing fails and records the failure', async () => {
    queue.add.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      scheduler.scheduleIdempotencyKeyExpiryPurge(),
    ).resolves.toBeUndefined();

    expect(metrics.recordIdempotencyPurgeFailure).toHaveBeenCalledWith(
      'scheduling: redis unavailable',
    );
  });
});
