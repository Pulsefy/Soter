import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryAdapter,
  DeliveryResult,
  ProviderReachabilityResult,
} from './delivery-adapter.interface';

/**
 * Console-based email adapter for development and testing (issue #941).
 *
 * Logs the email payload to the console and returns a synthetic
 * `providerMessageId` so the outbox can still track the "delivery".
 * Selected automatically when SENDGRID_API_KEY is not configured.
 */
@Injectable()
export class ConsoleEmailAdapter implements DeliveryAdapter {
  readonly channel = 'email' as const;
  readonly provider = 'console';
  private readonly logger = new Logger(ConsoleEmailAdapter.name);

  async checkReachability(): Promise<ProviderReachabilityResult> {
    await Promise.resolve();
    return {
      provider: this.provider,
      reachable: true,
      latencyMs: 0,
      skipped: true,
    };
  }

  async send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult> {
    await Promise.resolve();
    const messageId = `console-email-${Date.now()}`;

    this.logger.log(
      `[Console Email] To: ${params.recipient} | Subject: ${params.subject ?? '(none)'} | Body: ${params.message} | MessageId: ${messageId}`,
    );

    return {
      success: true,
      providerMessageId: messageId,
    };
  }
}
