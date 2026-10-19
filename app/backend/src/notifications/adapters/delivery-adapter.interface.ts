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

export interface ProviderReachabilityResult {
  /** Concrete provider behind the adapter (sendgrid, twilio, console, ...). */
  provider: string;
  /** Whether the provider was reachable and accepted the credentials. */
  reachable: boolean;
  /** Time spent on the probe, in milliseconds. */
  latencyMs: number;
  /**
   * True when there is no external provider to probe (for example the
   * console fallback used in development). Skipped probes never degrade
   * readiness.
   */
  skipped?: boolean;
  /** Human-readable failure reason. Never contains credentials. */
  error?: string;
}

export interface DeliveryAdapter {
  /** Which notification channel this adapter handles. */
  readonly channel: 'email' | 'sms';

  /** Concrete provider behind the adapter, used for health reporting. */
  readonly provider: string;

  /**
   * Deliver a notification.
   * Must NOT throw — delivery errors are returned in the result.
   */
  send(params: {
    recipient: string;
    subject?: string;
    message: string;
  }): Promise<DeliveryResult>;

  /**
   * Lightweight reachability probe used by `/health/ready`.
   *
   * Must NOT send a real notification and Must NOT throw — probe failures are
   * returned in the result so the health check can report a degraded provider.
   */
  checkReachability(timeoutMs: number): Promise<ProviderReachabilityResult>;
}

/** DI token for the email delivery adapter. */
export const EMAIL_ADAPTER = 'EMAIL_ADAPTER';

/** DI token for the SMS delivery adapter. */
export const SMS_ADAPTER = 'SMS_ADAPTER';
