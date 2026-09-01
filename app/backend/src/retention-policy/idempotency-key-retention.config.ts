/**
 * Configuration for IdempotencyKey expiry and garbage collection.
 *
 * The retention window is deliberately env-driven rather than stored in the
 * `RetentionPolicy` table: each IdempotencyKey row carries an explicit,
 * persisted `expiresAt` stamped at creation time, and the scheduled purge only
 * ever deletes rows whose `expiresAt` is already in the past. Keeping a single
 * authoritative source of truth here means the expiry stamped on new records
 * and the purge behavior can never drift from each other, and the cleanup
 * schedule itself never needs to know the configured window.
 */

export const IDEMPOTENCY_KEY_TTL_HOURS_ENV = 'IDEMPOTENCY_KEY_TTL_HOURS';
export const IDEMPOTENCY_PURGE_BATCH_SIZE_ENV = 'IDEMPOTENCY_PURGE_BATCH_SIZE';
export const IDEMPOTENCY_PURGE_MAX_BATCHES_ENV =
  'IDEMPOTENCY_PURGE_MAX_BATCHES_PER_RUN';

export const DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS = 24;
export const DEFAULT_IDEMPOTENCY_PURGE_BATCH_SIZE = 500;
export const DEFAULT_IDEMPOTENCY_PURGE_MAX_BATCHES = 100;

/**
 * Parse an env value as a positive integer, falling back to `fallback` when
 * the variable is unset or empty. Invalid (non-positive or non-integer) values
 * throw so a misconfigured deployment fails loudly instead of silently
 * producing dangerous retention behavior.
 */
function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${envName} "${raw}": expected a positive integer`);
  }
  return value;
}

/**
 * Retention window for idempotency keys, in hours. New records are stamped
 * with `expiresAt = now + ttlHours` and become invalid once that time passes.
 */
export function resolveIdempotencyKeyTtlHours(raw?: string): number {
  return parsePositiveInt(
    raw,
    DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS,
    IDEMPOTENCY_KEY_TTL_HOURS_ENV,
  );
}

/**
 * Maximum number of expired rows examined and deleted per purge batch.
 */
export function resolveIdempotencyPurgeBatchSize(raw?: string): number {
  return parsePositiveInt(
    raw,
    DEFAULT_IDEMPOTENCY_PURGE_BATCH_SIZE,
    IDEMPOTENCY_PURGE_BATCH_SIZE_ENV,
  );
}

/**
 * Upper bound on the number of batches a single purge run may process. This
 * keeps every scheduled run bounded even when a large backlog of expired rows
 * has accumulated; the schedule repeats, so the backlog is drained across runs.
 */
export function resolveIdempotencyPurgeMaxBatches(raw?: string): number {
  return parsePositiveInt(
    raw,
    DEFAULT_IDEMPOTENCY_PURGE_MAX_BATCHES,
    IDEMPOTENCY_PURGE_MAX_BATCHES_ENV,
  );
}
