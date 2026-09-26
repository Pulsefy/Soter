/**
 * Common interface for notification delivery adapters (issue #941).
 *
 * Adapters implement channel-specific delivery (email, SMS, push) behind
 * this interface so the NotificationProcessor stays provider-agnostic.
 */

export interface DeliveryResult {
  /** Whether the delivery was accepted by the provider. */
  success: boolean;
  /** Provider-assigned message ID (e.g. SendGrid x-message-id, Twilio SID). */
  providerMessageId?: string;
  /** Human-readable error when `success` is false. */
  error?: string;
}

export interface DeliveryAdapter {
  /** Which notification channel this adapter handles. */
  readonly channel: 'email' | 'sms';

  /**
   * Deliver a notification.
   * Must NOT throw — delivery errors are returned in the result.
   */
  send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult>;
}

/** DI token for the email delivery adapter. */
export const EMAIL_ADAPTER = 'EMAIL_ADAPTER';

/** DI token for the SMS delivery adapter. */
export const SMS_ADAPTER = 'SMS_ADAPTER';
