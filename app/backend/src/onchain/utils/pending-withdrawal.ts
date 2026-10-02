import { PendingWithdrawal } from '../onchain.adapter';

/**
 * Coercion helpers for reading a `PendingWithdrawal` struct back from a
 * decoded Soroban return value.
 *
 * Soroban structs decode to either a plain object or a `Map` depending on the
 * SDK version, `i128` amounts decode to `bigint`, and `u64` timestamps decode
 * to either `bigint` or `number`. These helpers collapse all of those shapes
 * onto the backend's `PendingWithdrawal`, and treat a payload with no usable
 * destination as "no proposal" rather than a half-populated one.
 */

/** Read a field from a decoded struct, tolerating both object and Map forms. */
function readField(data: unknown, field: string): unknown {
  if (data instanceof Map) {
    return data.get(field);
  }
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  return (data as Record<string, unknown>)[field];
}

/**
 * Read an `i128` amount as a decimal string.
 *
 * Amounts exceed `Number.MAX_SAFE_INTEGER` in practice, so they are never
 * routed through `Number`; only the transport representations are widened.
 */
export function readAmountString(value: unknown): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return '0';
}

/** Read a `u64` unix timestamp as a `number`. */
export function readTimestampNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Read an address field as a string, tolerating `undefined`. */
function readAddressField(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

/**
 * Parse a decoded `get_pending_withdrawal` return value.
 *
 * Returns `null` for the `None` case (void ScVal, `null`, or `undefined`) and
 * for any payload that lacks a destination address, since a proposal without
 * one cannot be executed and must not be presented as pending.
 */
export function parsePendingWithdrawal(raw: unknown): PendingWithdrawal | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'object') {
    return null;
  }

  const to = readAddressField(readField(raw, 'to'));
  if (!to) {
    return null;
  }

  return {
    to,
    token: readAddressField(readField(raw, 'token')),
    amount: readAmountString(readField(raw, 'amount')),
    executableAt: readTimestampNumber(readField(raw, 'executable_at')),
  };
}

/**
 * Seconds remaining until a pending proposal becomes executable, floored at 0.
 */
export function timelockRemainingSeconds(
  pending: PendingWithdrawal | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  if (!pending) {
    return 0;
  }
  return Math.max(0, pending.executableAt - nowSeconds);
}
