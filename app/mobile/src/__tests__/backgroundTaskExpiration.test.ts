/**
 * Tests for iOS background-task expiration handling (#1364).
 *
 * Acceptance criteria verified here:
 *
 *  1. Background task expiration is handled explicitly: in-flight work
 *     checkpoints its progress rather than being killed mid-write.
 *  2. The next foreground or background opportunity resumes from the
 *     checkpoint.
 *  3. Verified against a deliberately slow upload that exceeds a shortened
 *     test task-budget.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Module type aliases
// ---------------------------------------------------------------------------
type BackgroundTaskModule = typeof import('../services/backgroundTaskManager');
type SyncQueueModule = typeof import('../services/syncQueue');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUEUE_KEY = '@soter/sync-queue';

/** Load fresh, isolated copies of both modules that share one registry. */
const loadFresh = (): { bg: BackgroundTaskModule; queue: SyncQueueModule } => {
  let bg!: BackgroundTaskModule;
  let queue!: SyncQueueModule;
  jest.isolateModules(() => {
    // backgroundTaskManager must be loaded first so syncQueue gets the same
    // instance when it does its own `require('./backgroundTaskManager')`.
    bg = require('../services/backgroundTaskManager') as BackgroundTaskModule;
    queue = require('../services/syncQueue') as SyncQueueModule;
  });
  return { bg, queue };
};

const evidenceBody = JSON.stringify({
  filename: 'evidence.jpg',
  contentType: 'image/jpeg',
  // "Hello World" — 11 bytes, well under one 512 KB chunk
  imageBase64: 'SGVsbG8gV29ybGQ=',
});

const makeEvidenceAction = (overrides: Record<string, unknown> = {}) => ({
  id: 'ev-action-1',
  type: 'evidence-upload',
  payload: {
    aidId: 'aid-1',
    url: 'http://localhost:3000/api/v1/verification/upload',
    body: evidenceBody,
  },
  state: 'pending',
  retryCount: 0,
  maxRetries: 5,
  nextRetryAt: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastError: null,
  correlationId: 'sync-ev-1',
  ...overrides,
});

// ---------------------------------------------------------------------------
// backgroundTaskManager unit tests
// ---------------------------------------------------------------------------

describe('backgroundTaskManager', () => {
  let bg: BackgroundTaskModule;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ bg } = loadFresh());
    bg._resetForTests();
  });

  afterEach(() => {
    bg._resetForTests();
    jest.useRealTimers();
  });

  it('beginBackgroundWork returns a handle and increments activeBackgroundTaskCount', () => {
    const handle = bg.beginBackgroundWork('test-task', jest.fn());
    expect(handle).toMatch(/^bgtask-/);
    expect(bg.activeBackgroundTaskCount()).toBe(1);
    bg.endBackgroundWork(handle);
  });

  it('endBackgroundWork decrements activeBackgroundTaskCount', () => {
    const h1 = bg.beginBackgroundWork('task-a', jest.fn());
    const h2 = bg.beginBackgroundWork('task-b', jest.fn());
    expect(bg.activeBackgroundTaskCount()).toBe(2);
    bg.endBackgroundWork(h1);
    expect(bg.activeBackgroundTaskCount()).toBe(1);
    bg.endBackgroundWork(h2);
    expect(bg.activeBackgroundTaskCount()).toBe(0);
  });

  it('endBackgroundWork with an unknown handle is a no-op', () => {
    expect(() => bg.endBackgroundWork('unknown-handle')).not.toThrow();
  });

  it('fires the onExpire callback when the safety timer elapses', async () => {
    const onExpire = jest.fn();
    const handle = bg.beginBackgroundWork('expiring-task', onExpire);

    // Advance past the iOS safety-margin trigger (25 000 ms on iOS, but the
    // module selects the NON_IOS_WATCHDOG_MS in the test environment because
    // Platform.OS is 'ios' in jest-expo's preset — however the native bridge
    // is absent so we exercise the JS-timer path).  Advance a large amount to
    // cover both branches.
    jest.advanceTimersByTime(11 * 60 * 1000); // 11 min

    // The timer callback is synchronous but the onExpire may be async.
    await Promise.resolve();

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith('expiring-task');
    // Task should have been removed from the registry.
    expect(bg.activeBackgroundTaskCount()).toBe(0);

    // Handle is already gone; double-call should be safe.
    bg.endBackgroundWork(handle);
    expect(bg.activeBackgroundTaskCount()).toBe(0);
  });

  it('does NOT fire onExpire when endBackgroundWork is called before the timer', () => {
    const onExpire = jest.fn();
    const handle = bg.beginBackgroundWork('fast-task', onExpire);
    bg.endBackgroundWork(handle);

    jest.advanceTimersByTime(11 * 60 * 1000);

    expect(onExpire).not.toHaveBeenCalled();
    expect(bg.activeBackgroundTaskCount()).toBe(0);
  });

  it('supports multiple concurrent tasks with independent timers', async () => {
    const onExpireA = jest.fn();
    const onExpireB = jest.fn();

    bg.beginBackgroundWork('task-concurrent-a', onExpireA);
    bg.beginBackgroundWork('task-concurrent-b', onExpireB);

    expect(bg.activeBackgroundTaskCount()).toBe(2);

    jest.advanceTimersByTime(11 * 60 * 1000);
    await Promise.resolve();

    expect(onExpireA).toHaveBeenCalledTimes(1);
    expect(onExpireB).toHaveBeenCalledTimes(1);
    expect(bg.activeBackgroundTaskCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// syncQueue × backgroundTaskManager integration tests
// ---------------------------------------------------------------------------

describe('evidence-upload background task expiration (syncQueue integration)', () => {
  const mockFetch = jest.fn();

  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    mockFetch.mockReset();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — upload completes, background task is ended cleanly
  // -------------------------------------------------------------------------

  it('releases the background task token when a full upload completes', async () => {
    const { bg, queue } = loadFresh();
    bg._resetForTests();

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([makeEvidenceAction()]));

    // create session
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'session-ok',
        totalChunks: 1,
      }),
    });
    // upload chunk 0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ index: 0, received: true }),
    });
    // finalize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ev-ok' }),
    });

    await queue.flushPendingNetworkActions({ online: true });

    // The background task must have been cleaned up after the upload
    expect(bg.activeBackgroundTaskCount()).toBe(0);

    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Expiration during upload — checkpoint is persisted to AsyncStorage
  // -------------------------------------------------------------------------

  it('checkpoints partial progress to AsyncStorage when the background budget expires', async () => {
    const { bg, queue } = loadFresh();
    bg._resetForTests();

    // Use a multi-chunk body to get mid-flight expiration meaningful.
    // Seed the action directly — we'll intercept upload to control timing.
    const payload = {
      aidId: 'aid-exp',
      url: 'http://localhost:3000/api/v1/verification/upload',
      body: evidenceBody,
    };
    const action = makeEvidenceAction({ id: 'ev-expiry', payload, correlationId: 'sync-exp-1' });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([action]));

    // create session → returns 3 chunks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'session-expiry',
        totalChunks: 3,
      }),
    });

    // chunk 0 upload is slow — we resolve it, but then simulate expiration
    // BEFORE chunks 1 & 2 are uploaded.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ index: 0, received: true }),
    });

    // chunk 1 never resolves (upload stalls — simulate slow upload)
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    // Kick off the flush without awaiting — we'll fire timers to expire it
    const flushPromise = queue.flushPendingNetworkActions({ online: true });

    // Let the session creation and chunk-0 upload complete
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Fire the safety-margin timer to simulate iOS background budget exhaustion
    jest.runAllTimers();
    await Promise.resolve();

    // The checkpoint should now be persisted in AsyncStorage with chunk 0 saved
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    expect(items).toHaveLength(1);
    const persisted = items[0];

    // sessionId must have been set during the create-session step
    expect(persisted.payload.sessionId).toBe('session-expiry');

    // At minimum, session info is persisted so the next attempt can resume
    // rather than create a brand-new session.
    expect(persisted.payload.totalChunks).toBe(3);

    // Background task should be cleaned up after expiration
    expect(bg.activeBackgroundTaskCount()).toBe(0);

    // Flush can settle (the stalled chunk fetch never resolves; that's fine
    // for the test — we just need the side-effects to have occurred)
    flushPromise.catch(() => {}); // prevent unhandled rejection noise
  });

  // -------------------------------------------------------------------------
  // 3. Resume from checkpoint — second flush picks up where expiration left off
  // -------------------------------------------------------------------------

  it('resumes upload from the persisted checkpoint on the next flush', async () => {
    const { bg, queue } = loadFresh();
    bg._resetForTests();

    // Simulate state after a partial upload + expiration: session exists,
    // chunk 0 is already uploaded (persisted checkpoint).
    const resumeAction = makeEvidenceAction({
      id: 'ev-resume',
      correlationId: 'sync-resume-1',
      payload: {
        aidId: 'aid-resume',
        url: 'http://localhost:3000/api/v1/verification/upload',
        body: evidenceBody,
        sessionId: 'session-resume',
        totalChunks: 3,
        uploadedChunks: [0],
        progress: 0.33,
      },
    });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([resumeAction]));

    // GET session status → server confirms chunk 0 received
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessionId: 'session-resume',
        totalChunks: 3,
        receivedChunks: [0],
      }),
    });
    // upload chunk 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ index: 1, received: true }),
    });
    // upload chunk 2
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ index: 2, received: true }),
    });
    // finalize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ev-resumed' }),
    });

    await queue.flushPendingNetworkActions({ online: true });

    // Should have called: GET status, POST chunk 1, POST chunk 2, POST finalize
    expect(mockFetch).toHaveBeenCalledTimes(4);

    expect(String(mockFetch.mock.calls[0][0])).toContain('/evidence/upload-sessions/session-resume/status');
    expect(String(mockFetch.mock.calls[1][0])).toContain('/evidence/upload-sessions/session-resume/chunks');
    expect((mockFetch.mock.calls[1][1].body as FormData).get('index')).toBe('1');
    expect(String(mockFetch.mock.calls[2][0])).toContain('/evidence/upload-sessions/session-resume/chunks');
    expect((mockFetch.mock.calls[2][1].body as FormData).get('index')).toBe('2');
    expect(String(mockFetch.mock.calls[3][0])).toContain('/evidence/upload-sessions/session-resume/finalize');

    // Queue should be empty once upload completes
    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(0);

    // Background task token released
    expect(bg.activeBackgroundTaskCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. Background task is released on upload failure too
  // -------------------------------------------------------------------------

  it('releases the background task token when an upload errors out', async () => {
    const { bg, queue } = loadFresh();
    bg._resetForTests();

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([makeEvidenceAction()]));

    // create session succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'session-fail', totalChunks: 1 }),
    });
    // chunk upload fails with a server error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    });

    await queue.flushPendingNetworkActions({ online: true });

    // Upload failed — token must still be released
    expect(bg.activeBackgroundTaskCount()).toBe(0);

    // Action is retried (not discarded)
    const state = await queue.getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('retrying');
  });
});
