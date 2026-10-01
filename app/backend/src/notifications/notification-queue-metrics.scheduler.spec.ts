import { Queue } from 'bullmq';
import { MetricsService } from '../observability/metrics/metrics.service';
import { NotificationQueueMetricsScheduler } from './notification-queue-metrics.scheduler';

function makeScheduler(counts?: Record<string, number>) {
  const queue = {
    getJobCounts: jest.fn().mockResolvedValue(counts ?? {}),
  } as unknown as Queue;
  const metrics = { setGauge: jest.fn() } as unknown as MetricsService;
  const scheduler = new NotificationQueueMetricsScheduler(queue, metrics);
  return {
    scheduler,
    queue: queue as unknown as { getJobCounts: jest.Mock },
    metrics: metrics as unknown as { setGauge: jest.Mock },
  };
}

describe('NotificationQueueMetricsScheduler (issue #1180)', () => {
  it('publishes the depth of every notification queue state', async () => {
    const { scheduler, metrics } = makeScheduler({
      waiting: 3,
      delayed: 12,
      active: 1,
      failed: 2,
    });

    await scheduler.refreshQueueDepth();

    expect(metrics.setGauge).toHaveBeenCalledWith(
      'notification_queue_depth',
      3,
      { state: 'waiting' },
    );
    expect(metrics.setGauge).toHaveBeenCalledWith(
      'notification_queue_depth',
      12,
      { state: 'delayed' },
    );
    expect(metrics.setGauge).toHaveBeenCalledWith(
      'notification_queue_depth',
      1,
      { state: 'active' },
    );
    expect(metrics.setGauge).toHaveBeenCalledWith(
      'notification_queue_depth',
      2,
      { state: 'failed' },
    );
    expect(metrics.setGauge).toHaveBeenCalledTimes(4);
  });

  it('publishes zeroes for empty states so a drained backlog is visible', async () => {
    const { scheduler, metrics } = makeScheduler({
      waiting: 0,
      delayed: 0,
      active: 0,
      failed: 0,
    });

    await scheduler.refreshQueueDepth();

    expect(metrics.setGauge).toHaveBeenCalledWith(
      'notification_queue_depth',
      0,
      { state: 'delayed' },
    );
  });

  it('swallows queue errors instead of failing the cron tick', async () => {
    const queue = {
      getJobCounts: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
    } as unknown as Queue;
    const metrics = { setGauge: jest.fn() } as unknown as MetricsService;
    const scheduler = new NotificationQueueMetricsScheduler(queue, metrics);

    await expect(scheduler.refreshQueueDepth()).resolves.toBeUndefined();
    expect(metrics.setGauge).not.toHaveBeenCalled();
  });

  it('does nothing when no queue is registered', async () => {
    const metrics = { setGauge: jest.fn() } as unknown as MetricsService;
    const scheduler = new NotificationQueueMetricsScheduler(undefined, metrics);

    await scheduler.refreshQueueDepth();

    expect(metrics.setGauge).not.toHaveBeenCalled();
  });
});
