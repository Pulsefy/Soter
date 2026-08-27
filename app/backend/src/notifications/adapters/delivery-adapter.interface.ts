import { NotificationType } from '../interfaces/notification-job.interface';

/**
 * Result returned by any delivery adapter after attempting to send a notification.
 */
export interface DeliveryResult {
  /**
   * Whether the notification was successfully accepted by the provider.
   */
  success: boolean;

  /**
   * Provider-assigned message identifier (e.g., SendGrid msg ID, Twilio SID).
   * Only present when success is true.
   */
  providerMessageId?: string;

  /**
   * Error message if delivery failed. Only present when success is false.
   */
  error?: string;

  /**
   * Additional metadata from the provider (e.g., rate limit info, queue position).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Payload structure for email notifications.
 */
export interface EmailPayload {
  recipient: string;
  subject: string;
  message: string;
  html?: string;
  from?: string;
}

/**
 * Payload structure for SMS/push notifications.
 */
export interface SmsPayload {
  recipient: string;
  message: string;
  from?: string;
}

/**
 * Common interface that all notification delivery adapters must implement.
 * Adapters encapsulate provider-specific logic (SendGrid, Twilio, etc.)
 * and return a normalized DeliveryResult.
 */
export interface IDeliveryAdapter {
  /**
   * Returns the notification type this adapter handles.
   */
  getType(): NotificationType;

  /**
   * Delivers an email notification.
   * @throws Error if the adapter does not support email.
   */
  sendEmail(payload: EmailPayload): Promise<DeliveryResult>;

  /**
   * Delivers an SMS notification.
   * @throws Error if the adapter does not support SMS.
   */
  sendSms(payload: SmsPayload): Promise<DeliveryResult>;
}
