/**
 * Distinct failure for a surplus withdrawal executed before its timelock
 * matured.
 *
 * The contract answers a premature `execute_surplus_withdrawal` with
 * `SurplusWithdrawalTimelockActive`, which arrives at the backend as one
 * untyped string among many other `Error` variants. Callers — and the tests
 * guarding this delay window — need to tell "come back later" apart from
 * "this will never work", so adapters raise this type instead of a bare
 * `Error`, and the service turns it into a distinct HTTP response.
 */
export class SurplusWithdrawalTimelockNotElapsedError extends Error {
  override readonly name = 'SurplusWithdrawalTimelockNotElapsedError';

  /**
   * Unix timestamp (seconds) at which execution becomes possible, when known.
   * `null` when the adapter could not determine it.
   */
  readonly executableAt: number | null;

  constructor(message: string, executableAt: number | null = null) {
    super(message);
    this.executableAt = executableAt;
    Object.setPrototypeOf(
      this,
      SurplusWithdrawalTimelockNotElapsedError.prototype,
    );
  }
}

/**
 * Contract error variant raised when a withdrawal leg is attempted with no
 * proposal outstanding.
 */
export const SURPLUS_WITHDRAWAL_NOT_PENDING_ERROR =
  'SurplusWithdrawalNotPending';

/**
 * Contract error variant raised when a second proposal is submitted while one
 * is already pending.
 */
export const SURPLUS_WITHDRAWAL_PENDING_ERROR = 'SurplusWithdrawalPending';

/**
 * Delay the mock adapter applies between propose and execute.
 *
 * Mirrors the contract's `SURPLUS_WITHDRAWAL_DELAY_SECS` (86_400s, one day) so
 * tests exercise the same ordering the chain enforces. Overridable per adapter
 * instance via `mockSurplusWithdrawalDelaySeconds` so a test does not have to
 * wait a day.
 */
export const SURPLUS_WITHDRAWAL_TIMELOCK_SECS = 86_400;

/**
 * Coerce an unknown thrown value into text to search.
 *
 * `String(obj)` on a plain object yields `[object Object]`, which matches
 * nothing useful and would hide a real transport error, so non-Error values are
 * serialised instead. JSON is the shape a JSON-RPC or decoded-contract error
 * arrives in, and its `message` field is exactly what needs matching.
 */
function describeError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error === null || error === undefined) {
    return '';
  }
  try {
    // Renders primitives, arrays and objects faithfully. Returns undefined for
    // functions and symbols, and throws on BigInt, so both are normalised to an
    // empty string rather than being allowed to escape as a crash.
    const serialised = JSON.stringify(error, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    return serialised ?? '';
  } catch {
    return '';
  }
}

/**
 * True when `error` is (or wraps) the contract's premature-execution variant.
 *
 * Adapters and transports differ in how the variant surfaces — a decoded error
 * map, a JSON string, a JSON-RPC message — so the message is matched rather
 * than a discriminant.
 */
export function isSurplusWithdrawalTimelockError(error: unknown): boolean {
  if (error instanceof SurplusWithdrawalTimelockNotElapsedError) {
    return true;
  }
  const message = describeError(error);
  return (
    message.includes('SurplusWithdrawalTimelockActive') ||
    message.includes('SURPLUS_WITHDRAWAL_TIMELOCK_ACTIVE')
  );
}
