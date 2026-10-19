'use client';

import React, { useEffect } from 'react';
import { initOfflineStatusTracking } from '@/lib/offline-status';

/**
 * Registers the offline service worker (`public/sw.js`) and starts the
 * connectivity tracking that feeds `OfflineIndicator` (issue #1345).
 *
 * Renders nothing. Registration happens once the page has fully loaded so
 * the worker never competes with the initial asset burst, and only in
 * production builds: during `next dev`, Turbopack emits unstable chunk URLs
 * that would be poisoned by HTTP caching, so the worker stays off in
 * development. Connectivity tracking (the offline banner) works in every
 * environment regardless of whether the worker is registered.
 *
 * The worker calls `clients.claim()` on activate, so it takes control of
 * open tabs without a reload and starts protecting dashboard requests on
 * the very first visit.
 */
export const ServiceWorkerRegistration: React.FC = () => {
  useEffect(() => {
    const stopTracking = initOfflineStatusTracking();

    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return stopTracking;
    }

    const registerServiceWorker = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((error: unknown) => {
          // Offline support degrades gracefully without the worker; never
          // break the app over a failed registration.
          console.warn('[sw] service worker registration failed:', error);
        });
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    return () => {
      stopTracking();
      window.removeEventListener('load', registerServiceWorker);
    };
  }, []);

  return null;
};
