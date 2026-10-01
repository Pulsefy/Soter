import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  NotificationBackpressureService,
  NOTIFICATION_MAX_ATTEMPTS,
} from './notification-backpressure.service';

/**
 * Acceptance criterion of issue #1180: "a test simulates a sustained outage
 * and confirms other job types are not starved".
 *
 * The simulation models a *shared* worker pool that serves two queues — the
 * notification queue and an unrelated background queue — while the email
 * provider is down for the entire run and notifications keep arriving the
 * whole time. Every attempt against the dead provider burns a full timeout,
 * which is how a hanging provider behaves in practice.
 *
 * Two runs use the identical arrival schedule, provider and worker pool; only
 * the retry policy differs:
 *
 *  - `unboundedPolicy` is what ships today: an exponential backoff with no
 *    cutoff ("nothing limits how fast the outbox retries when a provider is
 *    down").
 *  - `backpressurePolicy` is this issue's change: escalating backoff + the
 *    circuit-breaker cutoff, taken straight from
 *    NotificationBackpressureService.
 */

const CONCURRENCY = 3;
const HORIZON_MS = 6 * 60_000;
const PROVIDER_ATTEMPT_MS = 4_000;
const GATE_CHECK_MS = 5;
const OTHER_JOB_MS = 100;
const OTHER_ARRIVAL_MS = 2_000;
const OTHER_SLA_MS = 15_000;
const NOTIFICATION_ARRIVAL_MS = 250;
/** Load stops this far before the horizon so the run can drain. */
const ARRIVAL_END_MS = HORIZON_MS - OTHER_SLA_MS;
const EMAIL = 'email' as const;

interface Policy {
  initialDelay(now: number): number;
  retryDelay(attemptsMade: number, now: number): number;
  attemptAllowed(now: number): boolean;
  recordFailure(now: number): void;
}

interface SimJob {
  id: number;
  kind: 'notification' | 'other';
  arriveAt: number;
  readyAt: number;
  attemptsMade: number;
  reachedProvider: boolean;
  finishAt: number;
  completedAt?: number;
}

interface SimResult {
  totalOtherJobs: number;
  completedOtherJobs: number;
  starvedOtherJobs: number;
  maxOtherLatencyMs: number;
  notificationsArrived: number;
  deadNotifications: number;
  providerAttempts: number;
}

function backpressurePolicy(service: NotificationBackpressureService): Policy {
  return {
    initialDelay: now => service.getInitialDelay(EMAIL, now),
    retryDelay: (attemptsMade, now) =>
      service.getRetryDelay(EMAIL, attemptsMade, now),
    attemptAllowed: now => {
      try {
        service.assertAttemptAllowed(EMAIL, now);
        return true;
      } catch {
        return false;
      }
    },
    recordFailure: now => service.recordFailure(EMAIL, now),
  };
}

/** The current behaviour: exponential backoff, no cutoff, no escalation. */
function unboundedPolicy(): Policy {
  const baseDelayMs = 5_000;
  return {
    initialDelay: () => 0,
    retryDelay: attemptsMade =>
      Math.round(baseDelayMs * 2 ** (attemptsMade - 1)),
    attemptAllowed: () => true,
    recordFailure: () => undefined,
  };
}

function earliestIndex(jobs: SimJob[]): number {
  let best = -1;
  for (let i = 0; i < jobs.length; i++) {
    if (
      best === -1 ||
      jobs[i].readyAt < jobs[best].readyAt ||
      (jobs[i].readyAt === jobs[best].readyAt && jobs[i].id < jobs[best].id)
    ) {
      best = i;
    }
  }
  return best;
}

function simulate(policy: Policy, attempts: number): SimResult {
  let clock = 0;
  let nextId = 0;
  let nextNotificationAt = 0;
  let nextOtherAt = 0;
  let providerAttempts = 0;
  let deadNotifications = 0;
  let notificationsArrived = 0;

  const workers: number[] = new Array(CONCURRENCY).fill(0);
  const running: SimJob[] = [];
  const ready: SimJob[] = [];
  const delayed: SimJob[] = [];
  const others: SimJob[] = [];

  while (clock <= HORIZON_MS) {
    // 1. finish everything whose attempt completed at or before now
    for (let i = running.length - 1; i >= 0; i--) {
      const job = running[i];
      if (job.finishAt > clock) continue;
      running.splice(i, 1);

      if (job.kind === 'other') {
        job.completedAt = job.finishAt;
        continue;
      }

      if (job.reachedProvider) {
        providerAttempts += 1;
        policy.recordFailure(job.finishAt);
      }

      job.attemptsMade += 1;
      if (job.attemptsMade >= attempts) {
        deadNotifications += 1;
        continue;
      }

      job.reachedProvider = false;
      job.readyAt =
        job.finishAt + policy.retryDelay(job.attemptsMade, job.finishAt);
      delayed.push(job);
    }

    // 2. arrivals — identical schedule for both policies
    while (nextNotificationAt <= clock && nextNotificationAt < ARRIVAL_END_MS) {
      const delay = policy.initialDelay(clock);
      ready.push({
        id: nextId++,
        kind: 'notification',
        arriveAt: nextNotificationAt,
        readyAt: clock + delay,
        attemptsMade: 0,
        reachedProvider: false,
        finishAt: 0,
      });
      notificationsArrived += 1;
      nextNotificationAt += NOTIFICATION_ARRIVAL_MS;
    }
    while (nextOtherAt <= clock && nextOtherAt < ARRIVAL_END_MS) {
      const job: SimJob = {
        id: nextId++,
        kind: 'other',
        arriveAt: nextOtherAt,
        readyAt: clock,
        attemptsMade: 0,
        reachedProvider: false,
        finishAt: 0,
      };
      ready.push(job);
      others.push(job);
      nextOtherAt += OTHER_ARRIVAL_MS;
    }

    // 3. jobs whose delay elapsed become runnable
    for (let i = delayed.length - 1; i >= 0; i--) {
      if (delayed[i].readyAt <= clock) {
        ready.push(delayed[i]);
        delayed.splice(i, 1);
      }
    }

    // 4. dispatch: one shared FIFO pool across both queues
    for (;;) {
      const slot = workers.findIndex(finishAt => finishAt <= clock);
      if (slot === -1) break;
      const index = earliestIndex(ready);
      if (index === -1) break;

      const job = ready.splice(index, 1)[0];
      const duration =
        job.kind === 'other'
          ? OTHER_JOB_MS
          : policy.attemptAllowed(clock)
            ? PROVIDER_ATTEMPT_MS
            : GATE_CHECK_MS;

      job.reachedProvider =
        job.kind === 'notification' && duration === PROVIDER_ATTEMPT_MS;
      job.finishAt = clock + duration;
      workers[slot] = job.finishAt;
      running.push(job);
    }

    // 5. advance to the next event
    if (clock >= HORIZON_MS) break;

    let next = HORIZON_MS;
    if (nextNotificationAt < ARRIVAL_END_MS)
      next = Math.min(next, nextNotificationAt);
    if (nextOtherAt < ARRIVAL_END_MS) next = Math.min(next, nextOtherAt);
    for (const job of running) next = Math.min(next, job.finishAt);
    for (const job of delayed) next = Math.min(next, job.readyAt);

    if (next <= clock) break;
    clock = next;
  }

  const latencies = others.map(
    job => (job.completedAt ?? HORIZON_MS) - job.arriveAt,
  );

  return {
    totalOtherJobs: others.length,
    completedOtherJobs: others.filter(job => job.completedAt !== undefined)
      .length,
    starvedOtherJobs: latencies.filter(latency => latency > OTHER_SLA_MS)
      .length,
    maxOtherLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    notificationsArrived,
    deadNotifications,
    providerAttempts,
  };
}

function makeBackpressureService(): NotificationBackpressureService {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const metrics = { setGauge: jest.fn() } as unknown as MetricsService;
  return new NotificationBackpressureService(config, metrics);
}

describe('sustained provider outage (issue #1180)', () => {
  it('keeps other job types flowing while the notification queue is under outage', () => {
    const backpressured = simulate(
      backpressurePolicy(makeBackpressureService()),
      NOTIFICATION_MAX_ATTEMPTS,
    );

    // Every background job finishes inside its SLA: nothing is starved.
    expect(backpressured.totalOtherJobs).toBeGreaterThan(50);
    expect(backpressured.completedOtherJobs).toBe(backpressured.totalOtherJobs);
    expect(backpressured.starvedOtherJobs).toBe(0);
    expect(backpressured.maxOtherLatencyMs).toBeLessThan(OTHER_SLA_MS);
  });

  it('shows that the same load starves other job types without backpressure', () => {
    const unbounded = simulate(unboundedPolicy(), NOTIFICATION_MAX_ATTEMPTS);

    // Control: identical load, no cutoff — the behaviour the issue describes.
    expect(unbounded.starvedOtherJobs).toBeGreaterThan(0);
    expect(unbounded.maxOtherLatencyMs).toBeGreaterThan(OTHER_SLA_MS);
  });

  it('defers notifications instead of dropping them, and shields the provider', () => {
    const backpressured = simulate(
      backpressurePolicy(makeBackpressureService()),
      NOTIFICATION_MAX_ATTEMPTS,
    );
    const unbounded = simulate(unboundedPolicy(), NOTIFICATION_MAX_ATTEMPTS);

    // Same notifications, same attempt budget — only the policy differs.
    expect(backpressured.notificationsArrived).toBe(
      unbounded.notificationsArrived,
    );
    expect(backpressured.notificationsArrived).toBeGreaterThan(100);

    // Nothing is dead-lettered inside the outage window: attempts are
    // deferred to the next probe window instead of being burnt.
    expect(backpressured.deadNotifications).toBe(0);

    // The circuit breaker also stops the queue from hammering the provider.
    expect(backpressured.providerAttempts).toBeLessThan(
      unbounded.providerAttempts,
    );
    expect(backpressured.providerAttempts).toBeLessThan(50);
  });
});
