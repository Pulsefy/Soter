import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryAdapter, DeliveryResult } from './delivery-adapter.interface';

/**
 * SMS delivery adapter using the Twilio REST API (issue #941).
 *
 * Uses raw `fetch()` with HTTP Basic Auth to avoid adding the
 * twilio npm package.
 * Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
 */
@Injectable()
export class TwilioSmsAdapter implements DeliveryAdapter {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(TwilioSmsAdapter.name);

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor(config: ConfigService) {
    const accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = config.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = config.get<string>('TWILIO_FROM_NUMBER');

    if (!accountSid) {
      throw new Error(
        'TWILIO_ACCOUNT_SID is required for TwilioSmsAdapter. ' +
          'Set it in env or use the console fallback adapter for development.',
      );
    }
    if (!authToken) {
      throw new Error('TWILIO_AUTH_TOKEN is required for TwilioSmsAdapter.');
    }
    if (!fromNumber) {
      throw new Error('TWILIO_FROM_NUMBER is required for TwilioSmsAdapter.');
    }

    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const formData = new URLSearchParams({
      To: params.recipient,
      From: this.fromNumber,
      Body: params.message,
    });

    const credentials = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (response.ok) {
        const data = (await response.json()) as { sid?: string };
        const sid = data.sid ?? `twilio-${Date.now()}`;

        this.logger.log(`SMS sent to ${params.recipient} (sid=${sid})`);

        return {
          success: true,
          providerMessageId: sid,
        };
      }

      const errorBody = await response
        .text()
        .catch(() => 'Unable to read body');
      this.logger.error(`Twilio API returned ${response.status}: ${errorBody}`);

      return {
        success: false,
        error: `Twilio API error: HTTP ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Twilio request failed: ${message}`);

      return {
        success: false,
        error: `Twilio request failed: ${message}`,
      };
    }
  }
}
