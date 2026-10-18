import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QueueBackpressureService } from './queue-backpressure.service';

const fakeQueue = (name: string, waiting: number | Error) =>
  ({
    name,
    getWaitingCount: jest.fn(() =>
      waiting instanceof Error
        ? Promise.reject(waiting)
        : Promise.resolve(waiting),
    ),
  }) as unknown as Queue;

function build(
  waiting: [number | Error, number | Error, number | Error],
  env: Record<string, string> = { BACKPRESSURE_WAITING_THRESHOLD: '10' },
) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new QueueBackpressureService(
    config,
    fakeQueue('verification', waiting[0]),
    fakeQueue('notifications', waiting[1]),
    fakeQueue('onchain', waiting[2]),
  );
}

describe('QueueBackpressureService', () => {
  it('reports no backpressure when queues are shallow', async () => {
    const state = await build([0, 3, 9]).getState();
    expect(state.active).toBe(false);
    expect(state.level).toBe('normal');
  });

  it('signals elevated backpressure when one queue reaches the threshold', async () => {
    const state = await build([10, 0, 0]).getState();
    expect(state.active).toBe(true);
    expect(state.level).toBe('elevated');
    expect(state.queues.find(q => q.name === 'verification')?.level).toBe(
      'elevated',
    );
  });

  it('signals critical backpressure at the critical multiple, using the worst queue', async () => {
    const state = await build([10, 50, 0]).getState();
    expect(state.level).toBe('critical');
    expect(state.queues.find(q => q.name === 'notifications')?.level).toBe(
      'critical',
    );
  });

  it('does not expose queue depths', async () => {
    const state = await build([500, 0, 0]).getState();
    expect(JSON.stringify(state)).not.toContain('500');
  });

  it('treats an unreachable queue as normal instead of failing', async () => {
    const state = await build([new Error('redis down'), 0, 0]).getState();
    expect(state.active).toBe(false);
  });

  it('caches the result briefly to protect Redis from polling', async () => {
    const svc = build([20, 0, 0]);
    await svc.getState(1_000);
    await svc.getState(2_000);
    expect(
      (svc as unknown as { queues: Queue[] }).queues[0].getWaitingCount,
    ).toHaveBeenCalledTimes(1);
    await svc.getState(10_000);
    expect(
      (svc as unknown as { queues: Queue[] }).queues[0].getWaitingCount,
    ).toHaveBeenCalledTimes(2);
  });
});
