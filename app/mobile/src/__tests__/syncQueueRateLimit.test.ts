/**
 * Tests for sync-queue rate-limit backoff (HTTP 429 + Retry-After).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  computeRateLimitBackoffMs,
  parseRetryAfterMs,
  RateLimitedError,
} from '../services/syncQueue';

const QUEUE_KEY = '@soter/sync-queue';
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

const seedStorage = async (items: object[]) => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
};

const makeQueuedClaimConfirmation = (overrides: Partial<object> = {}) => ({
  id: 'queued-confirm-1',
  type: 'claim-confirmation',
  payload: {
    aidId: 'aid-1',
    claimId: 'claim-1',
  },
  state: 'pending',
  retryCount: 0,
  maxRetries: 5,
  nextRetryAt: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastError: null,
  ...overrides,
});

type SyncQueueModule = typeof import('../services/syncQueue');

const loadFreshQueue = (): SyncQueueModule => {
  let mod!: SyncQueueModule;
  jest.isolateModules(() => {
    mod = require('../services/syncQueue') as SyncQueueModule;
  });
  return mod;
};

const mockFetch429 = (retryAfter?: string) => {
  const headers = {
    get: (name: string) => {
      if (name.toLowerCase() === 'retry-after') {
        return retryAfter ?? null;
      }
      return null;
    },
  };
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 429,
    headers,
    json: jest.fn().mockResolvedValue({ error: 'rate limited' }),
  }) as unknown as typeof fetch;
};

describe('parseRetryAfterMs', () => {
  it('parses delay-seconds Retry-After', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('returns null for missing or invalid values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('not-a-date')).toBeNull();
  });

  it('parses HTTP-date Retry-After into a positive delta', () => {
    const future = new Date(Date.now() + 45_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(40_000);
    expect(ms!).toBeLessThanOrEqual(45_000);
  });
});

describe('computeRateLimitBackoffMs', () => {
  it('uses Retry-After on the first 429 without extending past the header', () => {
    expect(computeRateLimitBackoffMs(1, 5_000)).toBe(5_000);
  });

  it('uses streak floor when Retry-After is absent', () => {
    expect(computeRateLimitBackoffMs(1, null)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(computeRateLimitBackoffMs(2, null)).toBe(BASE_RETRY_DELAY_MS * 4);
  });

  it('extends backoff on repeated 429s even if Retry-After shrinks', () => {
    const first = computeRateLimitBackoffMs(1, 5_000);
    const second = computeRateLimitBackoffMs(2, 5_000);
    expect(first).toBe(5_000);
    // streak floor for count=2 is 120s; must not reset to 5s
    expect(second).toBe(Math.max(5_000, BASE_RETRY_DELAY_MS * 4));
    expect(second).toBeGreaterThan(first);
  });

  it('caps at MAX_RETRY_DELAY_MS and applies saver multiplier', () => {
    const capped = computeRateLimitBackoffMs(20, null);
    expect(capped).toBe(MAX_RETRY_DELAY_MS);
    expect(computeRateLimitBackoffMs(1, 10_000, { saverMode: true })).toBe(30_000);
  });
});

describe('syncQueue rate-limit flush behaviour', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('schedules nextRetryAt from Retry-After on a 429 response', async () => {
    mockFetch429('90');
    await seedStorage([makeQueuedClaimConfirmation()]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();
    const before = Date.now();
    await flushPendingNetworkActions({ online: true });
    const after = Date.now();

    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('retrying');
    expect(state.items[0].rateLimitCount).toBe(1);
    expect(state.items[0].lastError).toContain('429');

    const nextAt = new Date(state.items[0].nextRetryAt).getTime();
    // ~90s from Retry-After
    expect(nextAt).toBeGreaterThanOrEqual(before + 90_000 - 1000);
    expect(nextAt).toBeLessThanOrEqual(after + 90_000 + 1000);
  });

  it('uses extended streak backoff when 429 has no Retry-After', async () => {
    mockFetch429();
    await seedStorage([makeQueuedClaimConfirmation()]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();
    const before = Date.now();
    await flushPendingNetworkActions({ online: true });
    const after = Date.now();

    const state = await getSyncQueueState();
    expect(state.items[0].rateLimitCount).toBe(1);
    const nextAt = new Date(state.items[0].nextRetryAt).getTime();
    const expected = BASE_RETRY_DELAY_MS * 2;
    expect(nextAt).toBeGreaterThanOrEqual(before + expected - 1000);
    expect(nextAt).toBeLessThanOrEqual(after + expected + 1000);
  });

  it('extends backoff across repeated 429s instead of resetting', async () => {
    mockFetch429('5');
    await seedStorage([
      makeQueuedClaimConfirmation({
        rateLimitCount: 1,
        retryCount: 1,
        state: 'retrying',
      }),
    ]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();
    const before = Date.now();
    await flushPendingNetworkActions({ online: true });
    const after = Date.now();

    const state = await getSyncQueueState();
    expect(state.items[0].rateLimitCount).toBe(2);
    const nextAt = new Date(state.items[0].nextRetryAt).getTime();
    // streak floor for count=2 is 120s, not the 5s Retry-After
    const expected = BASE_RETRY_DELAY_MS * 4;
    expect(nextAt).toBeGreaterThanOrEqual(before + expected - 1000);
    expect(nextAt).toBeLessThanOrEqual(after + expected + 1000);
  });

  it('does not treat rate-limit backoff as a deferral reason', async () => {
    mockFetch429('30');
    await seedStorage([makeQueuedClaimConfirmation()]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();
    await flushPendingNetworkActions({
      online: true,
      batteryLevel: 0.9,
      isCharging: true,
      isMetered: false,
    });

    const state = await getSyncQueueState();
    expect(state.items[0].deferralReason == null || state.items[0].deferralReason === 'none').toBe(
      true,
    );
    expect(state.deferralStatus?.deferred).not.toBe(true);
    expect(state.items[0].rateLimitCount).toBe(1);
  });

  it('RateLimitedError carries retryAfterMs from the header', () => {
    const err = new RateLimitedError(12_000);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(12_000);
    expect(err.message).toContain('429');
  });
});
