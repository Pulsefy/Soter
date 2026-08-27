import { Injectable, Logger } from '@nestjs/common';
import {
  IDeliveryAdapter,
  DeliveryResult,
  EmailPayload,
  SmsPayload,
} from './delivery-adapter.interface';
import { NotificationType } from '../interfaces/notification-job.interface';

/**
 * Mock delivery adapter for local development and testing.
 * Logs delivery attempts without calling external services.
 * Always returns success with a fake message ID.
 */
@Injectable()
export class MockDeliveryAdapter implements IDeliveryAdapter {
  private readonly logger = new Logger(MockDeliveryAdapter.name);

  getType(): NotificationType {
    // Mock adapter supports both types
    return NotificationType.EMAIL;
  }

  async sendEmail(payload: EmailPayload): Promise<DeliveryResult> {
    this.logger.debug(
      `[Mock] Sending email to ${payload.recipient}: ${payload.subject}`,
    );
    await this.simulateLatency();

    return {
      success: true,
      providerMessageId: `mock-email-${Date.now()}`,
      metadata: {
        provider: 'mock',
        type: 'email',
      },
    };
  }

  async sendSms(payload: SmsPayload): Promise<DeliveryResult> {
    this.logger.debug(
      `[Mock] Sending SMS to ${payload.recipient}: ${payload.message}`,
    );
    await this.simulateLatency();

    return {
      success: true,
      providerMessageId: `mock-sms-${Date.now()}`,
      metadata: {
        provider: 'mock',
        type: 'sms',
      },
    };
  }

  private async simulateLatency(): Promise<void> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
