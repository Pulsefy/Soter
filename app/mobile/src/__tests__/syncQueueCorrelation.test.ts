/**
 * Tests for sync queue correlation ids (issue #1159):
 *  - each queued item carries a correlation id generated at creation time
 *  - the id is sent as x-correlation-id / x-request-id on the item's API calls
 *  - every structured log line for the item (including retries) is tagged
 *    with the item's correlation id
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@soter/sync-queue';

type SyncQueueModule = typeof import('../services/syncQueue');
type LoggerModule = typeof import('../services/logger');

/** Load fresh copies of syncQueue and logger that share one module registry. */
const loadFresh = (): { queue: SyncQueueModule; logger: LoggerModule } => {
  let queue!: SyncQueueModule;
  let logger!: LoggerModule;
  jest.isolateModules(() => {
    queue = require('../services/syncQueue') as SyncQueueModule;
    logger = require('../services/logger') as LoggerModule;
  });
  return { queue, logger };
};

const makeSeededItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'seeded-1',
  type: 'claim-confirmation',
  payload: { aidId: 'aid-1', claimId: 'claim-9' },
  state: 'pending',
  retryCount: 0,
  maxRetries: 5,
  nextRetryAt: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastError: null,
  correlationId: 'sync-seeded-1',
  ...overrides,
});

describe('syncQueue correlation ids', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('generates a correlation id for each queued item at creation time', async () => {
    const { queue, logger } = loadFresh();
    logger.StructuredLogger.resetForTests();

    const result = await queue.dispatchNetworkAction(
      { type: 'claim-submission', payload: { aidId: 'aid-1', claimId: 'claim-1', idempotencyKey: 'idem-corr-1' } },
      { online: false },
    );

    expect(result.status).toBe('queued');
    if (result.status !== 'queued') return;
    expect(result.action.correlationId).toMatch(/^sync-/);

    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].correlationId).toBe(result.action.correlationId);

    // The enqueue log line is tagged with the item's correlation id.
    const syncEntries = logger.StructuredLogger.getInstance()
      .getEntries()
      .filter((entry) => entry.scope === 'sync');
    expect(syncEntries.length).toBeGreaterThan(0);
    for (const entry of syncEntries) {
      expect(entry.correlationId).toBe(result.action.correlationId);
    }
  });

  it('sends the correlation id as request headers on the item API call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as any);

    const { queue } = loadFresh();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([makeSeededItem()]));

    await queue.flushPendingNetworkActions({ online: true });

    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/claims/claim-9/verify');
    expect(init.headers).toMatchObject({
      'x-correlation-id': 'sync-seeded-1',
      'x-request-id': 'sync-seeded-1',
    });

    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(0);
  });

  it('keeps the same correlation id across retries and tags every log line with it', async () => {
    jest.spyOn(global, 'fetch' as any)
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as any);

    const { queue, logger } = loadFresh();
    logger.StructuredLogger.resetForTests();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([makeSeededItem({ correlationId: 'sync-retry-1' })]));

    await queue.flushPendingNetworkActions({ online: true });

    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('retrying');
    expect(state.items[0].correlationId).toBe('sync-retry-1');

    const syncEntries = logger.StructuredLogger.getInstance()
      .getEntries()
      .filter((entry) => entry.scope === 'sync');
    expect(syncEntries.length).toBeGreaterThan(0);
    for (const entry of syncEntries) {
      expect(entry.correlationId).toBe('sync-retry-1');
    }
    expect(syncEntries.some((entry) => entry.message === 'sync.flush.attempt')).toBe(true);
    expect(syncEntries.some((entry) => entry.message === 'sync.flush.failed')).toBe(true);
  });
});
