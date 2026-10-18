import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  NotificationBackpressureService,
  NotificationProvider,
} from './notification-backpressure.service';
import {
  DeliveryAdapter,
  EMAIL_ADAPTER,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';

/**
 * Synthetic canary probe schedule.
 *
 * A low-cost request is sent to each configured delivery provider on a
 * schedule that is independent of real notification traffic. Provider
 * degradation is therefore detected before it reaches real users, and
 * canary outcomes feed the provider circuit breaker so a failing provider
 * is cut off preemptively.
 *
 * Canary probes are distinguishable from real traffic:
 *  - logged with a `[Canary]` prefix and a dedicated canary recipient,
 *  - the probe body is stamped as synthetic,
 *  - probe outcomes are tracked in a separate `notification_canary_probes_total`
 *    counter so they never inflate real delivery cost metrics.
 */
@Injectable()
export class NotificationCanaryScheduler {
  private readonly logger = new Logger(NotificationCanaryScheduler.name);
  private readonly config: CanaryConfig;
  private readonly adapters = new Map<NotificationProvider, DeliveryAdapter>();
  /** Last minute (epoch ms floored to a minute) a canary ran per provider. */
  private readonly lastRunAt = new Map<NotificationProvider, number>();

  constructor(
    config: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly backpressure: NotificationBackpressureService,
    @Inject(EMAIL_ADAPTER) emailAdapter: DeliveryAdapter,
    @Inject(SMS_ADAPTER) smsAdapter: DeliveryAdapter,
  ) {
    this.adapters.set('email', emailAdapter);
    this.adapters.set('sms', smsAdapter);
    this.config = readCanaryConfig(config);
  }

  /**
   * Tick every minute. A provider's canary only actually fires when its
   * configured cron expression is due, so the effective schedule is the
   * configured per-provider cron (default: email every 5 min, SMS every 10).
   */
  /**
   * Tick every minute. A provider's canary only actually fires when its
   * configured cron expression is due, so the effective schedule is the
   * configured per-provider cron (default: email every 5 min, SMS every 10).
   * `now` is injected for testing.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'notification-canary-probe' })
  async probe(now: number = Date.now()): Promise<void> {
    if (!this.config.enabled) return;

    const nowMinute = Math.floor(now / 60_000) * 60_000;

    for (const provider of ['email', 'sms'] as const) {
      const providerConfig = this.config[provider];
      if (!providerConfig.enabled) continue;
      if (!cronMatches(providerConfig.cron, new Date(now))) continue;
      if ((this.lastRunAt.get(provider) ?? 0) >= nowMinute) continue;

      await this.runCanary(provider, now);
      this.lastRunAt.set(provider, nowMinute);
    }
  }

  /** Send one synthetic probe against a provider and record the outcome. */
  private async runCanary(
    provider: NotificationProvider,
    now: number,
  ): Promise<void> {
    const adapter = this.adapters.get(provider)!;
    const recipient = this.config[provider].recipient;

    try {
      const result = await adapter.send({
        recipient,
        subject: `[Canary] ${provider} health probe`,
        message: `Synthetic canary probe for the ${provider} provider at ${new Date(
          now,
        ).toISOString()}. This is not real traffic.`,
      });

      const ok = result.success;
      if (ok) {
        this.backpressure.recordSuccess(provider, now);
        this.metricsService.incrementCounter(
          'notification_canary_probes_total',
          { provider, outcome: 'success' },
        );
        this.logger.log(
          `[Canary] ${provider} probe succeeded for ${recipient} (messageId=${result.providerMessageId})`,
        );
      } else {
        this.backpressure.recordFailure(provider, now);
        this.metricsService.incrementCounter(
          'notification_canary_probes_total',
          { provider, outcome: 'failure' },
        );
        this.logger.warn(
          `[Canary] ${provider} probe failed for ${recipient}: ${result.error}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.backpressure.recordFailure(provider, now);
      this.metricsService.incrementCounter('notification_canary_probes_total', {
        provider,
        outcome: 'error',
      });
      this.logger.error(
        `[Canary] ${provider} probe errored for ${recipient}: ${message}`,
      );
    }
  }
}

export interface CanaryProviderConfig {
  enabled: boolean;
  cron: string;
  recipient: string;
}

export interface CanaryConfig {
  enabled: boolean;
  email: CanaryProviderConfig;
  sms: CanaryProviderConfig;
}

const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  enabled: true,
  email: {
    enabled: true,
    cron: '*/5 * * * *',
    recipient: 'canary@example.com',
  },
  sms: {
    enabled: true,
    cron: '*/10 * * * *',
    recipient: '+15550000000',
  },
};

function readCanaryConfig(config: ConfigService): CanaryConfig {
  const enabled = config.get<string>('NOTIFICATION_CANARY_ENABLED') !== 'false';

  const provider = (
    cronKey: string,
    recipientKey: string,
    disabledKey: string,
    defaults: CanaryProviderConfig,
  ): CanaryProviderConfig => ({
    enabled: enabled && config.get<string>(disabledKey) !== 'true',
    cron: config.get<string>(cronKey) ?? defaults.cron,
    recipient: config.get<string>(recipientKey) ?? defaults.recipient,
  });

  return {
    enabled,
    email: provider(
      'NOTIFICATION_CANARY_CRON_EMAIL',
      'NOTIFICATION_CANARY_EMAIL_RECIPIENT',
      'NOTIFICATION_CANARY_DISABLE_EMAIL',
      DEFAULT_CANARY_CONFIG.email,
    ),
    sms: provider(
      'NOTIFICATION_CANARY_CRON_SMS',
      'NOTIFICATION_CANARY_SMS_RECIPIENT',
      'NOTIFICATION_CANARY_DISABLE_SMS',
      DEFAULT_CANARY_CONFIG.sms,
    ),
  };
}

/** Minute-granularity match for a standard 5-field cron expression. */
function cronMatches(expr: string, date: Date): boolean {
  const [min, hour, dom, month, dow] = expr.trim().split(/\s+/);
  return (
    cronFieldMatches(min, date.getMinutes(), 60) &&
    cronFieldMatches(hour, date.getHours(), 24) &&
    cronFieldMatches(dom, date.getDate(), 31) &&
    cronFieldMatches(month, date.getMonth() + 1, 12) &&
    cronFieldMatches(dow, date.getDay(), 7)
  );
}

function cronFieldMatches(field: string, value: number, max: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (cronPartMatches(part, value, max)) return true;
  }
  return false;
}

function cronPartMatches(part: string, value: number, max: number): boolean {
  let range: string;
  let step = 1;
  if (part.includes('/')) {
    const [rangePart, stepPart] = part.split('/');
    range = rangePart;
    const parsed = Number(stepPart);
    step = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } else {
    range = part;
  }

  let start: number;
  let end: number;
  if (range === '*') {
    start = 0;
    end = max - 1;
  } else if (range.includes('-')) {
    const [a, b] = range.split('-').map(Number);
    start = a;
    end = b;
  } else {
    start = end = Number(range);
  }

  return value >= start && value <= end && (value - start) % step === 0;
}
