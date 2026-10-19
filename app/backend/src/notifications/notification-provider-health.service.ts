import { Inject, Injectable } from '@nestjs/common';
import {
  DeliveryAdapter,
  EMAIL_ADAPTER,
  ProviderReachabilityResult,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';
import { NotificationProvider } from './notification-backpressure.service';

export type NotificationProviderChecks = Record<
  NotificationProvider,
  ProviderReachabilityResult
>;

/**
 * Runs lightweight reachability probes against the configured notification
 * delivery providers (issue #1384).
 *
 * Probes validate provider connectivity/credentials without sending a real
 * email or SMS. The readiness endpoint consumes these results as a
 * non-critical dependency: an outage degrades readiness instead of making the
 * whole service unavailable.
 */
@Injectable()
export class NotificationProviderHealthService {
  constructor(
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: DeliveryAdapter,
    @Inject(SMS_ADAPTER) private readonly smsAdapter: DeliveryAdapter,
  ) {}

  async checkProviders(timeoutMs: number): Promise<NotificationProviderChecks> {
    const [email, sms] = await Promise.all([
      this.probe(this.emailAdapter, timeoutMs),
      this.probe(this.smsAdapter, timeoutMs),
    ]);

    return { email, sms };
  }

  private async probe(
    adapter: DeliveryAdapter,
    timeoutMs: number,
  ): Promise<ProviderReachabilityResult> {
    try {
      return await adapter.checkReachability(timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: adapter.provider,
        reachable: false,
        latencyMs: 0,
        error: `Provider health check failed: ${message}`,
      };
    }
  }
}
