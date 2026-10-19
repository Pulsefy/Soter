import { create } from 'zustand';

/**
 * Connectivity state for the offline experience (issue #1345).
 *
 * Two signals feed this store:
 *
 * 1. The browser's `online`/`offline` events (via `navigator.onLine`),
 *    updated by `initOfflineStatusTracking`.
 * 2. Messages posted by the service worker (`public/sw.js`) when it serves
 *    a dashboard API response from cache because the network failed or
 *    timed out. This catches the case where `navigator.onLine` is true but
 *    the backend is unreachable — the exact "unreliable connectivity"
 *    scenario the dashboard must tolerate in the field.
 *
 * `isOnline` defaults to `true` so server-rendered HTML matches the first
 * client render (no hydration mismatch); `initOfflineStatusTracking` corrects
 * it with the real value immediately after mount.
 */

export const OFFLINE_MESSAGE_TYPES = {
  cachedResponse: 'soter:cached-response',
  networkResponse: 'soter:network-response',
} as const;

export interface OfflineStatusState {
  /** Browser-reported connectivity (navigator.onLine). */
  isOnline: boolean;
  /**
   * True while the service worker is answering dashboard requests from its
   * cache because the network is unavailable — drives the
   * "offline, showing cached data" indicator.
   */
  isServingCachedData: boolean;
  /** URL of the last API response served from cache (diagnostics). */
  lastCachedUrl: string | null;
  /** Epoch millis the cached response was stored, when the SW reported it. */
  cachedAt: number | null;
  /** Cached response is older than the service worker's freshness TTL. */
  isStaleCache: boolean;
}

const INITIAL_STATE: OfflineStatusState = {
  isOnline: true,
  isServingCachedData: false,
  lastCachedUrl: null,
  cachedAt: null,
  isStaleCache: false,
};

export const useOfflineStatusStore = create<OfflineStatusState>(() => ({
  ...INITIAL_STATE,
}));

export function setConnectivityOnline(online: boolean): void {
  useOfflineStatusStore.setState(() => ({
    isOnline: online,
    // Regaining connectivity clears the cached-data flag; the next
    // successful network response (or failure) re-establishes it.
    ...(online
      ? { isServingCachedData: false, isStaleCache: false, lastCachedUrl: null, cachedAt: null }
      : {}),
  }));
}

export function markServingCachedData(payload: {
  url: string;
  cachedAt: number | null;
  stale: boolean;
}): void {
  useOfflineStatusStore.setState({
    isServingCachedData: true,
    lastCachedUrl: payload.url,
    cachedAt: payload.cachedAt,
    isStaleCache: payload.stale,
  });
}

export function markNetworkResponseServed(): void {
  useOfflineStatusStore.setState(state =>
    state.isServingCachedData
      ? { isServingCachedData: false, isStaleCache: false, lastCachedUrl: null, cachedAt: null }
      : state,
  );
}

function isServiceWorkerMessage(
  data: unknown,
): data is { type: string; url?: unknown; cachedAt?: unknown; stale?: unknown } {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string';
}

let stopTracking: (() => void) | null = null;

/**
 * Start listening to connectivity and service-worker events. Idempotent —
 * safe to call from multiple components; returns a cleanup function that
 * stops tracking (used by `ServiceWorkerRegistration` on unmount and by
 * tests between cases).
 */
export function initOfflineStatusTracking(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (stopTracking) {
    return stopTracking;
  }

  const handleOnline = () => setConnectivityOnline(true);
  const handleOffline = () => setConnectivityOnline(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  setConnectivityOnline(navigator.onLine);

  const handleServiceWorkerMessage = (event: MessageEvent) => {
    if (!isServiceWorkerMessage(event.data)) return;
    if (event.data.type === OFFLINE_MESSAGE_TYPES.cachedResponse) {
      markServingCachedData({
        url: typeof event.data.url === 'string' ? event.data.url : '',
        cachedAt: typeof event.data.cachedAt === 'number' ? event.data.cachedAt : null,
        stale: Boolean(event.data.stale),
      });
    } else if (event.data.type === OFFLINE_MESSAGE_TYPES.networkResponse) {
      markNetworkResponseServed();
    }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  }

  stopTracking = () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    }
    stopTracking = null;
  };

  return stopTracking;
}

/** Test-only: restore the initial state and detach any active listeners. */
export function resetOfflineStatusForTests(): void {
  if (stopTracking) {
    stopTracking();
  }
  useOfflineStatusStore.setState({ ...INITIAL_STATE }, true);
}
