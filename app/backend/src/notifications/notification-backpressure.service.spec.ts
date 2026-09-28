import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';
import { NotificationType } from './interfaces/notification-job.interface';
import {
  CIRCUIT_STATE_CODES,
  DEFAULT_BACKPRESSURE_CONFIG,
  NotificationBackpressureService,
  ProviderCircuitOpenError,
  notificationBackoffStrategy,
  providerForType,
} from './notification-backpressure.service';

const { baseDelayMs, maxDelayMs, failureThreshold, probeIntervalMs } =
  DEFAULT_BACKPRESSURE_CONFIG;

const T0 = 1_700_000_000_000;

function makeService() {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const metrics = { setGauge: jest.fn() } as unknown as MetricsService;
  const service = new NotificationBackpressureService(config, metrics);
  return { service, metrics: metrics as unknown as { setGauge: jest.Mock } };
}

/** Drive the circuit open with `failureThreshold` consecutive failures. */
function tripCircuit(
  service: NotificationBackpressureService,
  now = T0,
): number {
  for (let i = 0; i < failureThreshold; i++) {
    service.recordFailure('email', now + i);
  }
  return now + failureThreshold - 1; // timestamp of the last failure
}

describe('NotificationBackpressureService', () => {
  let service: NotificationBackpressureService;
  let metrics: { setGauge: jest.Mock };

  beforeEach(() => {
    ({ service, metrics } = makeService());
  });

  describe('escalating retry backoff (issue #1180)', () => {
    it('increases the delay with every attempt', () => {
      const first = service.getRetryDelay('email', 1, T0);
      const second = service.getRetryDelay('email', 2, T0);
      const third = service.getRetryDelay('email', 3, T0);

      expect(first).toBe(baseDelayMs);
      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);
    });

    it('caps the delay at maxDelayMs', () => {
      expect(service.getRetryDelay('email', 50, T0)).toBe(maxDelayMs);
    });

    it('increases the delay further under sustained provider failure', () => {
      const calm = service.getRetryDelay('email', 1, T0);

      // Four failures: below the cutoff threshold, so the circuit is still
      // closed — the delay must grow purely from the failure run.
      for (let i = 0; i < failureThreshold - 1; i++) {
        service.recordFailure('email', T0 + i);
      }

      const sustained = service.getRetryDelay('email', 1, T0);
      expect(sustained).toBeGreaterThan(calm);
      expect(sustained).toBeLessThanOrEqual(maxDelayMs);
    });

    it('keeps the backoff capped even with many failures and attempts', () => {
      for (let i = 0; i < 30; i++) {
        service.recordFailure('email', T0 + i);
      }

      expect(service.getRetryDelay('email', 40, T0 + 30)).toBe(maxDelayMs);
    });
  });

  describe('circuit-breaker cutoff', () => {
    it('stays closed below the failure threshold', () => {
      for (let i = 0; i < failureThreshold - 1; i++) {
        service.recordFailure('email', T0 + i);
      }

      expect(service.getSnapshot('email').state).toBe('closed');
      expect(() =>
        service.assertAttemptAllowed('email', T0 + 10),
      ).not.toThrow();
      expect(service.getInitialDelay('email', T0 + 10)).toBe(0);
    });

    it('opens after failureThreshold consecutive failures and refuses attempts', () => {
      const lastFailureAt = tripCircuit(service);

      expect(service.getSnapshot('email').state).toBe('open');
      expect(() =>
        service.assertAttemptAllowed('email', lastFailureAt + 1),
      ).toThrow(ProviderCircuitOpenError);

      // New sends are parked until the probe window instead of joining the
      // outage.
      const initialDelay = service.getInitialDelay('email', lastFailureAt + 1);
      expect(initialDelay).toBeGreaterThan(0);
      expect(initialDelay).toBeLessThanOrEqual(probeIntervalMs);
    });

    it('does not open on failures from other providers', () => {
      tripCircuit(service);

      expect(service.getSnapshot('sms').state).toBe('closed');
      expect(() => service.assertAttemptAllowed('sms', T0)).not.toThrow();
    });

    it('lets the first attempt after the probe window act as the health probe', () => {
      const lastFailureAt = tripCircuit(service);
      const probeAt = lastFailureAt + probeIntervalMs;

      expect(() =>
        service.assertAttemptAllowed('email', probeAt),
      ).not.toThrow();
      expect(service.getSnapshot('email').state).toBe('half_open');
    });

    it('closes the circuit when the health probe succeeds', () => {
      const lastFailureAt = tripCircuit(service);
      const probeAt = lastFailureAt + probeIntervalMs;

      service.assertAttemptAllowed('email', probeAt);
      service.recordSuccess('email', probeAt + 10);

      expect(service.getSnapshot('email').state).toBe('closed');
      expect(service.getSnapshot('email').consecutiveFailures).toBe(0);
      expect(service.getInitialDelay('email', probeAt + 20)).toBe(0);
      expect(() =>
        service.assertAttemptAllowed('email', probeAt + 20),
      ).not.toThrow();
      // Escalation is gone as well: the base delay is back.
      expect(service.getRetryDelay('email', 1, probeAt + 20)).toBe(baseDelayMs);
    });

    it('stays open for another full window when the health probe fails', () => {
      const lastFailureAt = tripCircuit(service);
      const probeAt = lastFailureAt + probeIntervalMs;

      service.assertAttemptAllowed('email', probeAt);
      service.recordFailure('email', probeAt + 5);

      expect(service.getSnapshot('email').state).toBe('open');
      expect(() => service.assertAttemptAllowed('email', probeAt + 6)).toThrow(
        ProviderCircuitOpenError,
      );
      expect(service.getInitialDelay('email', probeAt + 6)).toBeGreaterThan(0);
    });

    it('never schedules a retry before the probe window has elapsed', () => {
      const lastFailureAt = tripCircuit(service);

      const delay = service.getRetryDelay('email', 1, lastFailureAt + 1);
      expect(lastFailureAt + 1 + delay).toBeGreaterThanOrEqual(
        lastFailureAt + probeIntervalMs,
      );
    });

    it('treats a probe that never reports back as an open circuit again', () => {
      const lastFailureAt = tripCircuit(service);
      const probeAt = lastFailureAt + probeIntervalMs;
      service.assertAttemptAllowed('email', probeAt);

      // Half-open, but the attempt never came back.
      expect(() =>
        service.assertAttemptAllowed('email', probeAt + probeIntervalMs),
      ).toThrow(ProviderCircuitOpenError);
      expect(service.getSnapshot('email').state).toBe('open');
    });
  });

  describe('metrics (issue #1180)', () => {
    it('publishes the provider failure rate as a gauge', () => {
      service.recordFailure('email', T0);
      expect(metrics.setGauge).toHaveBeenCalledWith(
        'notification_provider_failure_rate',
        1,
        { provider: 'email' },
      );

      service.recordSuccess('email', T0 + 1);
      expect(metrics.setGauge).toHaveBeenCalledWith(
        'notification_provider_failure_rate',
        0.5,
        { provider: 'email' },
      );
    });

    it('publishes the circuit state as a gauge', () => {
      tripCircuit(service);

      expect(metrics.setGauge).toHaveBeenLastCalledWith(
        'notification_circuit_state',
        CIRCUIT_STATE_CODES.open,
        { provider: 'email' },
      );

      service.recordSuccess('email', T0 + probeIntervalMs);
      expect(metrics.setGauge).toHaveBeenLastCalledWith(
        'notification_circuit_state',
        CIRCUIT_STATE_CODES.closed,
        { provider: 'email' },
      );
    });

    it('reports a zero failure rate before any attempt is made', () => {
      expect(service.getFailureRate('email', T0)).toBe(0);
    });

    it('forgets outcomes that fall outside the sliding window', () => {
      service.recordFailure('email', T0);

      expect(
        service.getFailureRate(
          'email',
          T0 + DEFAULT_BACKPRESSURE_CONFIG.failureWindowMs + 1,
        ),
      ).toBe(0);
    });
  });

  describe('notificationBackoffStrategy', () => {
    it('delegates to the active service using the job type', () => {
      const delay = notificationBackoffStrategy(2, 'custom', undefined, {
        id: 'job-1',
        data: { type: NotificationType.SMS },
      } as never);

      expect(delay).toBe(service.getRetryDelay('sms', 2));
      expect(delay).toBe(baseDelayMs * 2);
    });

    it('falls back to exponential backoff without an active service', () => {
      service.onModuleDestroy();

      expect(notificationBackoffStrategy(1)).toBe(baseDelayMs);
      expect(notificationBackoffStrategy(3)).toBe(baseDelayMs * 4);
    });

    it('falls back when the job carries no recognisable type', () => {
      expect(
        notificationBackoffStrategy(4, 'custom', undefined, {} as never),
      ).toBe(baseDelayMs * 8);
    });
  });

  describe('providerForType', () => {
    it('maps notification types onto delivery providers', () => {
      expect(providerForType(NotificationType.EMAIL)).toBe('email');
      expect(providerForType(NotificationType.SMS)).toBe('sms');
    });
  });
});
