import {
  DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS,
  DEFAULT_IDEMPOTENCY_PURGE_BATCH_SIZE,
  DEFAULT_IDEMPOTENCY_PURGE_MAX_BATCHES,
  resolveIdempotencyKeyTtlHours,
  resolveIdempotencyPurgeBatchSize,
  resolveIdempotencyPurgeMaxBatches,
} from './idempotency-key-retention.config';

describe('idempotency-key-retention.config', () => {
  describe('resolveIdempotencyKeyTtlHours', () => {
    it('returns the default when the env var is unset', () => {
      expect(resolveIdempotencyKeyTtlHours(undefined)).toBe(
        DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS,
      );
    });

    it('returns the default when the env var is empty', () => {
      expect(resolveIdempotencyKeyTtlHours('')).toBe(
        DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS,
      );
      expect(resolveIdempotencyKeyTtlHours('   ')).toBe(
        DEFAULT_IDEMPOTENCY_KEY_TTL_HOURS,
      );
    });

    it('parses a valid positive integer', () => {
      expect(resolveIdempotencyKeyTtlHours('48')).toBe(48);
    });

    it('rejects zero', () => {
      expect(() => resolveIdempotencyKeyTtlHours('0')).toThrow(
        /positive integer/,
      );
    });

    it('rejects negative values', () => {
      expect(() => resolveIdempotencyKeyTtlHours('-1')).toThrow(
        /positive integer/,
      );
    });

    it('rejects non-integer values', () => {
      expect(() => resolveIdempotencyKeyTtlHours('1.5')).toThrow(
        /positive integer/,
      );
    });

    it('rejects non-numeric garbage', () => {
      expect(() => resolveIdempotencyKeyTtlHours('forever')).toThrow(
        /positive integer/,
      );
    });
  });

  describe('resolveIdempotencyPurgeBatchSize', () => {
    it('returns the default when unset', () => {
      expect(resolveIdempotencyPurgeBatchSize(undefined)).toBe(
        DEFAULT_IDEMPOTENCY_PURGE_BATCH_SIZE,
      );
    });

    it('parses a valid value', () => {
      expect(resolveIdempotencyPurgeBatchSize('250')).toBe(250);
    });

    it('rejects invalid values', () => {
      expect(() => resolveIdempotencyPurgeBatchSize('0')).toThrow(
        /positive integer/,
      );
      expect(() => resolveIdempotencyPurgeBatchSize('abc')).toThrow(
        /positive integer/,
      );
    });
  });

  describe('resolveIdempotencyPurgeMaxBatches', () => {
    it('returns the default when unset', () => {
      expect(resolveIdempotencyPurgeMaxBatches(undefined)).toBe(
        DEFAULT_IDEMPOTENCY_PURGE_MAX_BATCHES,
      );
    });

    it('parses a valid value', () => {
      expect(resolveIdempotencyPurgeMaxBatches('5')).toBe(5);
    });

    it('rejects invalid values', () => {
      expect(() => resolveIdempotencyPurgeMaxBatches('0')).toThrow(
        /positive integer/,
      );
      expect(() => resolveIdempotencyPurgeMaxBatches('-3')).toThrow(
        /positive integer/,
      );
    });
  });
});
