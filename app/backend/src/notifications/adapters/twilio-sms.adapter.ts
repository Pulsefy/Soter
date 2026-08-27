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
 * Twilio SMS delivery adapter.
 * Implements real SMS delivery via Twilio's HTTP API.
 *
 * Required environment variables:
 * - TWILIO_ACCOUNT_SID: Twilio account SID
 * - TWILIO_AUTH_TOKEN: Twilio auth token
 * - TWILIO_FROM_PHONE: Default sender phone number (E.164 format)
 */
@Injectable()
export class TwilioSmsAdapter implements IDeliveryAdapter {
  private readonly logger = new Logger(TwilioSmsAdapter.name);
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromPhone: string;

  constructor(private readonly configService: ConfigService) {
    this.accountSid =
      this.configService.get<string>('TWILIO_ACCOUNT_SID') || '';
    this.authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN') || '';
    this.fromPhone = this.configService.get<string>('TWILIO_FROM_PHONE') || '';

    if (!this.accountSid || !this.authToken || !this.fromPhone) {
      this.logger.warn(
        'Twilio adapter initialized but missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_PHONE. SMS will fail.',
      );
    }
  }

  getType(): NotificationType {
    return NotificationType.SMS;
  }

  async sendEmail(_payload: EmailPayload): Promise<DeliveryResult> {
    return {
      success: false,
      error: 'Twilio adapter does not support email delivery',
    };
  }

  async sendSms(payload: SmsPayload): Promise<DeliveryResult> {
    if (!this.accountSid || !this.authToken || !this.fromPhone) {
      return {
        success: false,
        error:
          'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_PHONE.',
      };
    }

    try {
      const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('To', payload.recipient);
      formData.append('From', payload.from || this.fromPhone);
      formData.append('Body', payload.message);

      this.logger.debug(
        `Sending SMS via Twilio to ${payload.recipient}: ${payload.message}`,
      );

      const response = await axios.post(apiUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: this.accountSid,
          password: this.authToken,
        },
      });

      const messageId = response.data.sid || `twilio-${Date.now()}`;
      const status = response.data.status;

      this.logger.log(
        `SMS sent successfully to ${payload.recipient} (sid: ${messageId}, status: ${status})`,
      );

      return {
        success: true,
        providerMessageId: messageId,
        metadata: {
          provider: 'twilio',
          status,
          statusCode: response.status,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorData = axiosError.response?.data as {
        message?: string;
        code?: number;
      };
      const errorMessage =
        errorData?.message || axiosError.message || 'Unknown Twilio error';

      this.logger.error(
        `Twilio SMS delivery failed for ${payload.recipient}: ${errorMessage} (code: ${errorData?.code || 'unknown'})`,
      );

      return {
        success: false,
        error: `Twilio error: ${errorMessage}`,
        metadata: {
          provider: 'twilio',
          statusCode: axiosError.response?.status,
          errorCode: errorData?.code,
        },
      };
    }
  }
}
