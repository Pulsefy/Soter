'use client';

import { useSyncExternalStore } from 'react';
import {
  useOfflineStatusStore,
  type OfflineStatusState,
} from '@/lib/offline-status';

/**
 * Live view of connectivity + cached-data state for the offline experience.
 *
 * Backed by the zustand store in `@/lib/offline-status`, which is fed by
 * browser online/offline events and by messages from the service worker
 * (`public/sw.js`) whenever it answers a dashboard request from cache.
 *
 * The server snapshot is the all-clear initial state so server-rendered
 * HTML never flashes an offline banner; the real value lands right after
 * mount via `initOfflineStatusTracking` (see `ServiceWorkerRegistration`).
 */
export function useOfflineStatus(): OfflineStatusState {
  return useSyncExternalStore(
    useOfflineStatusStore.subscribe,
    useOfflineStatusStore.getState,
    useOfflineStatusStore.getState,
  );
}
