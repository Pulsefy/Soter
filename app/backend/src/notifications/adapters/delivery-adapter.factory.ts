import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IDeliveryAdapter } from './delivery-adapter.interface';
import { MockDeliveryAdapter } from './mock-delivery.adapter';
import { SendGridEmailAdapter } from './sendgrid-email.adapter';
import { TwilioSmsAdapter } from './twilio-sms.adapter';
import { NotificationType } from '../interfaces/notification-job.interface';

/**
 * Factory that selects the appropriate delivery adapter based on configuration.
 * Supports both explicit mock mode and automatic fallback when real providers
 * are not configured.
 *
 * Configuration:
 * - NOTIFICATION_DELIVERY_MODE: 'mock' | 'real' (default: 'real')
 * - For real email: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL
 * - For real SMS: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_PHONE
 */
@Injectable()
export class DeliveryAdapterFactory {
  private readonly logger = new Logger(DeliveryAdapterFactory.name);
  private readonly deliveryMode: 'mock' | 'real';
  private readonly mockAdapter: MockDeliveryAdapter;
  private readonly emailAdapter: SendGridEmailAdapter;
  private readonly smsAdapter: TwilioSmsAdapter;

  constructor(
    private readonly configService: ConfigService,
    mockAdapter: MockDeliveryAdapter,
    emailAdapter: SendGridEmailAdapter,
    smsAdapter: TwilioSmsAdapter,
  ) {
    this.mockAdapter = mockAdapter;
    this.emailAdapter = emailAdapter;
    this.smsAdapter = smsAdapter;

    const mode = this.configService.get<string>('NOTIFICATION_DELIVERY_MODE');
    this.deliveryMode = mode === 'mock' ? 'mock' : 'real';

    this.logger.log(`Notification delivery mode: ${this.deliveryMode}`);

    // Validate configuration for real mode
    if (this.deliveryMode === 'real') {
      this.validateRealModeConfig();
    }
  }

  /**
   * Returns the appropriate adapter for the given notification type.
   * Falls back to mock adapter if real provider is not configured.
   */
  getAdapter(type: NotificationType): IDeliveryAdapter {
    if (this.deliveryMode === 'mock') {
      this.logger.debug(`Using mock adapter for ${type} (mode=mock)`);
      return this.mockAdapter;
    }

    // Real mode: select provider-specific adapter
    switch (type) {
      case NotificationType.EMAIL:
        if (this.isEmailConfigured()) {
          this.logger.debug(`Using SendGrid adapter for ${type}`);
          return this.emailAdapter;
        } else {
          this.logger.warn(
            `SendGrid not configured, falling back to mock for ${type}`,
          );
          return this.mockAdapter;
        }

      case NotificationType.SMS:
        if (this.isSmsConfigured()) {
          this.logger.debug(`Using Twilio adapter for ${type}`);
          return this.smsAdapter;
        } else {
          this.logger.warn(
            `Twilio not configured, falling back to mock for ${type}`,
          );
          return this.mockAdapter;
        }

      default:
        this.logger.warn(`Unknown notification type ${type}, using mock`);
        return this.mockAdapter;
    }
  }

  /**
   * Checks if SendGrid email configuration is present.
   */
  private isEmailConfigured(): boolean {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const fromEmail = this.configService.get<string>('SENDGRID_FROM_EMAIL');
    return Boolean(apiKey && fromEmail);
  }

  /**
   * Checks if Twilio SMS configuration is present.
   */
  private isSmsConfigured(): boolean {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromPhone = this.configService.get<string>('TWILIO_FROM_PHONE');
    return Boolean(accountSid && authToken && fromPhone);
  }

  /**
   * Validates configuration when in real mode.
   * Logs warnings if providers are not configured (will fall back to mock).
   */
  private validateRealModeConfig(): void {
    const emailConfigured = this.isEmailConfigured();
    const smsConfigured = this.isSmsConfigured();

    if (!emailConfigured && !smsConfigured) {
      this.logger.warn(
        'NOTIFICATION_DELIVERY_MODE=real but no real providers configured. ' +
          'All notifications will use mock delivery. ' +
          'Set SENDGRID_API_KEY+SENDGRID_FROM_EMAIL for email or ' +
          'TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN+TWILIO_FROM_PHONE for SMS.',
      );
    } else {
      if (!emailConfigured) {
        this.logger.warn(
          'SendGrid not configured. Email notifications will use mock delivery.',
        );
      }
      if (!smsConfigured) {
        this.logger.warn(
          'Twilio not configured. SMS notifications will use mock delivery.',
        );
      }
    }
  }
}
