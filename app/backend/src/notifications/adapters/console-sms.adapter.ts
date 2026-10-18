import { Injectable, Logger } from '@nestjs/common';
import { DeliveryAdapter, DeliveryResult } from './delivery-adapter.interface';

/**
 * Console-based SMS adapter for development and testing (issue #941).
 *
 * Logs the SMS payload to the console and returns a synthetic
 * `providerMessageId` so the outbox can still track the "delivery".
 * Selected automatically when TWILIO_ACCOUNT_SID is not configured.
 */
@Injectable()
export class ConsoleSmsAdapter implements DeliveryAdapter {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(ConsoleSmsAdapter.name);

  async send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult> {
    await Promise.resolve();
    const messageId = `console-sms-${Date.now()}`;

    this.logger.log(
      `[Console SMS] To: ${params.recipient} | Body: ${params.message} | MessageId: ${messageId}`,
    );

    return {
      success: true,
      providerMessageId: messageId,
    };
  }
}
