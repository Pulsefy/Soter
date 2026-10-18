/**
 * Classifies a raw notification-delivery error into a small, bounded set
 * of categories (issue #716).
 *
 * This exists specifically to avoid the cardinality-explosion pattern
 * already present elsewhere in this codebase (e.g. MetricsService's
 * incrementCallbackFailure/incrementTxSubmissionFailure, which pass raw,
 * unbounded error text as a Prometheus label). A fixed category set keeps
 * both the metric and the persisted failureCategory column meaningful for
 * filtering/aggregation, while errorMessage still keeps the full raw text
 * for debugging.
 */
export type NotificationFailureCategory =
  | 'timeout'
  | 'rate_limited'
  | 'invalid_recipient'
  | 'provider_error'
  | 'unknown';

export function classifyNotificationFailure(
  error: unknown,
): NotificationFailureCategory {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();

  if (/timed?\s?out|timeout|etimedout/.test(message)) {
    return 'timeout';
  }
  if (/rate.?limit|429|too many requests/.test(message)) {
    return 'rate_limited';
  }
  if (
    /invalid (recipient|email|phone|address)|malformed|bad recipient/.test(
      message,
    )
  ) {
    return 'invalid_recipient';
  }
  if (
    /5\d{2}\b|provider error|upstream error|service unavailable/.test(message)
  ) {
    return 'provider_error';
  }
  return 'unknown';
}
