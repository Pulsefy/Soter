import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';
import { NotificationBackpressureService } from './notification-backpressure.service';
import { DeliveryAdapter } from './adapters/delivery-adapter.interface';
import { NotificationCanaryScheduler } from './notification-canary.scheduler';

const T0 = 1_704_067_200_000; // 2024-01-01T00:00:00Z (minute 0)
const T5 = T0 + 5 * 60_000; // 2024-01-01T00:05:00Z (minute 5)

function makeConfig(overrides: Record<string, string> = {}) {
  const get = jest.fn((key: string) => overrides[key] ?? undefined);
  return { get } as unknown as ConfigService;
}

function makeAdapter(sendResult: {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}): DeliveryAdapter {
  return {
    send: jest.fn().mockResolvedValue(sendResult),
  } as unknown as DeliveryAdapter;
}

function makeSchedulers(overrides: Record<string, string> = {}) {
  const config = makeConfig(overrides);
  const metrics = { incrementCounter: jest.fn() } as unknown as MetricsService;
  const backpressure = {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  } as unknown as NotificationBackpressureService;
  const emailAdapter = makeAdapter({
    success: true,
    providerMessageId: 'canary-email-1',
  });
  const smsAdapter = makeAdapter({
    success: true,
    providerMessageId: 'canary-sms-1',
  });
  const scheduler = new NotificationCanaryScheduler(
    config,
    metrics,
    backpressure,
    emailAdapter,
    smsAdapter,
  );
  return { scheduler, config, metrics, backpressure, emailAdapter, smsAdapter };
}

function adaptersOf(scheduler: NotificationCanaryScheduler) {
  return (
    scheduler as unknown as {
      adapters: Map<string, { send: jest.Mock<any> }>;
    }
  ).adapters;
}

function runCanaryOf(scheduler: NotificationCanaryScheduler) {
  return (
    scheduler as unknown as {
      runCanary: (p: string, t: number) => Promise<void>;
    }
  ).runCanary.bind(scheduler);
}

function probeOf(scheduler: NotificationCanaryScheduler) {
  return (
    scheduler as unknown as { probe: (t?: number) => Promise<void> }
  ).probe.bind(scheduler);
}

describe('NotificationCanaryScheduler', () => {
  describe('runCanary', () => {
    it('records a successful probe against the provider circuit', async () => {
      const { scheduler, backpressure, metrics } = makeSchedulers();
      const send = jest.fn().mockResolvedValue({
        success: true,
        providerMessageId: 'canary-1',
      });
      adaptersOf(scheduler).get('email')!.send = send;

      await runCanaryOf(scheduler)('email', T0);

      expect(send).toHaveBeenCalledWith({
        recipient: 'canary@example.com',
        subject: '[Canary] email health probe',
        message: expect.stringContaining('not real traffic'),
      });
      expect(backpressure.recordSuccess).toHaveBeenCalledWith('email', T0);
      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'notification_canary_probes_total',
        { provider: 'email', outcome: 'success' },
      );
    });

    it('records a failed probe against the provider circuit', async () => {
      const { scheduler, backpressure, metrics } = makeSchedulers();
      const send = jest.fn().mockResolvedValue({
        success: false,
        error: 'upstream unavailable',
      });
      adaptersOf(scheduler).get('email')!.send = send;

      await runCanaryOf(scheduler)('email', T0);

      expect(backpressure.recordFailure).toHaveBeenCalledWith('email', T0);
      expect(backpressure.recordSuccess).not.toHaveBeenCalled();
      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'notification_canary_probes_total',
        { provider: 'email', outcome: 'failure' },
      );
    });

    it('records an errored probe as a failure', async () => {
      const { scheduler, backpressure, metrics } = makeSchedulers();
      const send = jest.fn().mockRejectedValue(new Error('network down'));
      adaptersOf(scheduler).get('sms')!.send = send;

      await runCanaryOf(scheduler)('sms', T0);

      expect(backpressure.recordFailure).toHaveBeenCalledWith('sms', T0);
      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'notification_canary_probes_total',
        { provider: 'sms', outcome: 'error' },
      );
    });

    it('uses the configured canary recipient', async () => {
      const { scheduler } = makeSchedulers({
        NOTIFICATION_CANARY_EMAIL_RECIPIENT: 'probe@example.org',
      });
      const send = jest.fn().mockResolvedValue({ success: true });
      adaptersOf(scheduler).get('email')!.send = send;

      await runCanaryOf(scheduler)('email', T0);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'probe@example.org' }),
      );
    });
  });

  describe('probe (minute ticker)', () => {
    it('fires every configured provider when the cron is due', async () => {
      const { scheduler, metrics } = makeSchedulers();
      await probeOf(scheduler)(T0);

      const adapters = adaptersOf(scheduler);
      expect(adapters.get('email')!.send).toHaveBeenCalledTimes(1);
      expect(adapters.get('sms')!.send).toHaveBeenCalledTimes(1);
      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'notification_canary_probes_total',
        { provider: 'email', outcome: 'success' },
      );
    });

    it('skips providers whose cron is not due this minute', async () => {
      const { scheduler } = makeSchedulers();
      await probeOf(scheduler)(T5);

      const adapters = adaptersOf(scheduler);
      // minute 5: email (*/5) fires, sms (*/10) does not
      expect(adapters.get('email')!.send).toHaveBeenCalledTimes(1);
      expect(adapters.get('sms')!.send).not.toHaveBeenCalled();
    });

    it('does not probe when canary is globally disabled', async () => {
      const { scheduler } = makeSchedulers({
        NOTIFICATION_CANARY_ENABLED: 'false',
      });
      await probeOf(scheduler)(T0);

      const adapters = adaptersOf(scheduler);
      expect(adapters.get('email')!.send).not.toHaveBeenCalled();
      expect(adapters.get('sms')!.send).not.toHaveBeenCalled();
    });

    it('skips a provider disabled per provider', async () => {
      const { scheduler } = makeSchedulers({
        NOTIFICATION_CANARY_DISABLE_EMAIL: 'true',
      });
      await probeOf(scheduler)(T0);

      const adapters = adaptersOf(scheduler);
      expect(adapters.get('email')!.send).not.toHaveBeenCalled();
      expect(adapters.get('sms')!.send).toHaveBeenCalledTimes(1);
    });

    it('does not double-fire within the same minute', async () => {
      const { scheduler } = makeSchedulers();
      await probeOf(scheduler)(T0);
      await probeOf(scheduler)(T0 + 1_000);

      const adapters = adaptersOf(scheduler);
      expect(adapters.get('email')!.send).toHaveBeenCalledTimes(1);
      expect(adapters.get('sms')!.send).toHaveBeenCalledTimes(1);
    });
  });
});
