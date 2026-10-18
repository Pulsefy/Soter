import { AsyncLocalStorage } from 'async_hooks';
import { CORRELATION_ID_KEY } from './correlation-id.util';

/**
 * Shape of the async-local-storage slot the application logger reads the
 * correlation ID from (see LoggerService.getAsyncLocalStorage()).
 */
export type CorrelationContextStore = Map<string, unknown>;

/**
 * Build the async-local-storage store for a correlation ID.
 *
 * Kept in one place so every entry point that re-establishes a correlation
 * context (HTTP middleware, queue processors, cron schedulers) writes exactly
 * the same shape the logger expects.
 */
export function createCorrelationContext(
  correlationId: string,
): CorrelationContextStore {
  return new Map<string, unknown>([[CORRELATION_ID_KEY, correlationId]]);
}

/**
 * Run `fn` with the given correlation ID bound to `storage`.
 *
 * Used to carry a correlation ID across asynchronous boundaries where the
 * original HTTP request context no longer exists - most notably BullMQ jobs
 * picked up by a worker in a different tick (or a different process) than the
 * request that enqueued them.
 *
 * When `correlationId` is missing or blank the callback runs as-is, so callers
 * never lose the ambient context they already had.
 */
export function runWithCorrelationContext<T>(
  storage: AsyncLocalStorage<CorrelationContextStore>,
  correlationId: string | null | undefined,
  fn: () => T,
): T {
  const normalized = correlationId?.trim();
  if (!normalized) {
    return fn();
  }

  return storage.run(createCorrelationContext(normalized), fn);
}
