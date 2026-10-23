/**
 * @jest-environment jsdom
 */

import {
  OFFLINE_MESSAGE_TYPES,
  initOfflineStatusTracking,
  markNetworkResponseServed,
  markServingCachedData,
  resetOfflineStatusForTests,
  setConnectivityOnline,
  useOfflineStatusStore,
} from './offline-status';

const swListeners = new Map<string, (event: MessageEvent) => void>();

const mockServiceWorker = {
  addEventListener: jest.fn((type: string, listener: (event: MessageEvent) => void) => {
    swListeners.set(type, listener);
  }),
  removeEventListener: jest.fn((type: string) => {
    swListeners.delete(type);
  }),
};

function dispatchServiceWorkerMessage(data: unknown) {
  const listener = swListeners.get('message');
  if (listener) listener({ data } as MessageEvent);
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('offline-status store', () => {
  beforeEach(() => {
    resetOfflineStatusForTests();
    swListeners.clear();
    mockServiceWorker.addEventListener.mockClear();
    mockServiceWorker.removeEventListener.mockClear();
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: mockServiceWorker,
    });
    setNavigatorOnline(true);
  });

  afterEach(() => {
    resetOfflineStatusForTests();
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('starts optimistic so server-rendered HTML matches the first client render', () => {
    const state = useOfflineStatusStore.getState();
    expect(state.isOnline).toBe(true);
    expect(state.isServingCachedData).toBe(false);
  });

  it('tracks browser connectivity transitions', () => {
    const stop = initOfflineStatusTracking();

    window.dispatchEvent(new Event('offline'));
    expect(useOfflineStatusStore.getState().isOnline).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(useOfflineStatusStore.getState().isOnline).toBe(true);

    stop();
  });

  it('reflects the real navigator.onLine value on init', () => {
    setNavigatorOnline(false);
    const stop = initOfflineStatusTracking();
    expect(useOfflineStatusStore.getState().isOnline).toBe(false);
    stop();
  });

  it('marks cached data as being served when the service worker reports a cache hit', () => {
    const stop = initOfflineStatusTracking();

    dispatchServiceWorkerMessage({
      type: OFFLINE_MESSAGE_TYPES.cachedResponse,
      url: 'http://localhost:4000/api/v1/analytics/global-stats',
      cachedAt: 1_700_000_000_000,
      stale: true,
    });

    const state = useOfflineStatusStore.getState();
    expect(state.isServingCachedData).toBe(true);
    expect(state.lastCachedUrl).toBe(
      'http://localhost:4000/api/v1/analytics/global-stats',
    );
    expect(state.cachedAt).toBe(1_700_000_000_000);
    expect(state.isStaleCache).toBe(true);

    stop();
  });

  it('clears the cached-data flag once a live network response lands', () => {
    const stop = initOfflineStatusTracking();
    markServingCachedData({ url: '/api/v1/aid/packages', cachedAt: Date.now(), stale: false });
    expect(useOfflineStatusStore.getState().isServingCachedData).toBe(true);

    dispatchServiceWorkerMessage({
      type: OFFLINE_MESSAGE_TYPES.networkResponse,
      url: '/api/v1/aid/packages',
    });

    expect(useOfflineStatusStore.getState().isServingCachedData).toBe(false);
    stop();
  });

  it('clears the cached-data flag when connectivity is regained', () => {
    markServingCachedData({ url: '/api/v1/aid/packages', cachedAt: Date.now(), stale: false });
    setConnectivityOnline(true);
    expect(useOfflineStatusStore.getState().isServingCachedData).toBe(false);
  });

  it('ignores malformed or unrelated service worker messages', () => {
    const stop = initOfflineStatusTracking();
    markNetworkResponseServed();

    dispatchServiceWorkerMessage(null);
    dispatchServiceWorkerMessage('nope');
    dispatchServiceWorkerMessage({ type: 'unrelated' });

    expect(useOfflineStatusStore.getState().isServingCachedData).toBe(false);
    stop();
  });

  it('is idempotent and detaches listeners on cleanup', () => {
    const stopFirst = initOfflineStatusTracking();
    const stopSecond = initOfflineStatusTracking();
    expect(mockServiceWorker.addEventListener).toHaveBeenCalledTimes(1);

    stopFirst();
    expect(mockServiceWorker.removeEventListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function),
    );

    // The duplicate cleanup is the same function and safe to call again.
    stopSecond();
  });
});
