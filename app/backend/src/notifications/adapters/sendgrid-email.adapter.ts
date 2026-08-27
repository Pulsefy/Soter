import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  IDeliveryAdapter,
  DeliveryResult,
  EmailPayload,
  SmsPayload,
} from './delivery-adapter.interface';
import { NotificationType } from '../interfaces/notification-job.interface';

/**
 * SendGrid email delivery adapter.
 * Implements real email delivery via SendGrid's HTTP API.
 *
 * Required environment variables:
 * - SENDGRID_API_KEY: SendGrid API key
 * - SENDGRID_FROM_EMAIL: Default sender email address
 * - SENDGRID_FROM_NAME: Default sender name (optional)
 */
@Injectable()
export class SendGridEmailAdapter implements IDeliveryAdapter {
  private readonly logger = new Logger(SendGridEmailAdapter.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly apiUrl = 'https://api.sendgrid.com/v3/mail/send';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SENDGRID_API_KEY') || '';
    this.fromEmail =
      this.configService.get<string>('SENDGRID_FROM_EMAIL') || '';
    this.fromName =
      this.configService.get<string>('SENDGRID_FROM_NAME') || 'Soter';

    if (!this.apiKey || !this.fromEmail) {
      this.logger.warn(
        'SendGrid adapter initialized but missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL. Emails will fail.',
      );
    }
  }

  getType(): NotificationType {
    return NotificationType.EMAIL;
  }

  async sendEmail(payload: EmailPayload): Promise<DeliveryResult> {
    if (!this.apiKey || !this.fromEmail) {
      return {
        success: false,
        error:
          'SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.',
      };
    }

    try {
      const requestBody = {
        personalizations: [
          {
            to: [{ email: payload.recipient }],
            subject: payload.subject,
          },
        ],
        from: {
          email: payload.from || this.fromEmail,
          name: this.fromName,
        },
        content: [
          {
            type: payload.html ? 'text/html' : 'text/plain',
            value: payload.html || payload.message,
          },
        ],
      };

      this.logger.debug(
        `Sending email via SendGrid to ${payload.recipient}: ${payload.subject}`,
      );

      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // SendGrid returns 202 Accepted on success
      // The message ID is in the X-Message-Id header
      const messageId =
        response.headers['x-message-id'] || `sendgrid-${Date.now()}`;

      this.logger.log(
        `Email sent successfully to ${payload.recipient} (messageId: ${messageId})`,
      );

      return {
        success: true,
        providerMessageId: messageId,
        metadata: {
          provider: 'sendgrid',
          statusCode: response.status,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage =
        axiosError.response?.data ||
        axiosError.message ||
        'Unknown SendGrid error';

      this.logger.error(
        `SendGrid email delivery failed for ${payload.recipient}: ${JSON.stringify(errorMessage)}`,
      );

      return {
        success: false,
        error: `SendGrid error: ${JSON.stringify(errorMessage)}`,
        metadata: {
          provider: 'sendgrid',
          statusCode: axiosError.response?.status,
        },
      };
    }
  }

  async sendSms(_payload: SmsPayload): Promise<DeliveryResult> {
    return {
      success: false,
      error: 'SendGrid adapter does not support SMS delivery',
    };
  }
}
