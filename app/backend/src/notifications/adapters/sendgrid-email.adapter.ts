import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryAdapter, DeliveryResult } from './delivery-adapter.interface';

/**
 * Email delivery adapter using the SendGrid v3 Mail Send API (issue #941).
 *
 * Uses raw `fetch()` to avoid adding the @sendgrid/mail dependency.
 * Requires env vars: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL.
 */
@Injectable()
export class SendGridEmailAdapter implements DeliveryAdapter {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(SendGridEmailAdapter.name);

  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly apiUrl = 'https://api.sendgrid.com/v3/mail/send';

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('SENDGRID_API_KEY');
    const fromEmail = config.get<string>('SENDGRID_FROM_EMAIL');

    if (!apiKey) {
      throw new Error(
        'SENDGRID_API_KEY is required for SendGridEmailAdapter. ' +
          'Set it in env or use the console fallback adapter for development.',
      );
    }
    if (!fromEmail) {
      throw new Error(
        'SENDGRID_FROM_EMAIL is required for SendGridEmailAdapter.',
      );
    }

    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
  }

  async send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult> {
    const body = {
      personalizations: [
        {
          to: [{ email: params.recipient }],
          subject: params.subject ?? 'Notification',
        },
      ],
      from: { email: this.fromEmail },
      content: [
        {
          type: 'text/plain',
          value: params.message,
        },
      ],
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 202 || response.status === 200) {
        // SendGrid returns the message ID in the x-message-id header
        const messageId =
          response.headers.get('x-message-id') ?? `sg-${Date.now()}`;

        this.logger.log(
          `Email sent to ${params.recipient} (messageId=${messageId})`,
        );

        return {
          success: true,
          providerMessageId: messageId,
        };
      }

      // Non-success status
      const errorBody = await response
        .text()
        .catch(() => 'Unable to read body');
      this.logger.error(
        `SendGrid API returned ${response.status}: ${errorBody}`,
      );

      return {
        success: false,
        error: `SendGrid API error: HTTP ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SendGrid request failed: ${message}`);

      return {
        success: false,
        error: `SendGrid request failed: ${message}`,
      };
    }
  }
}
