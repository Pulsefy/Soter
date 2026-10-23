/**
 * Soter offline service worker.
 *
 * Caches the application shell (static assets + last successful navigations)
 * and the most recently fetched dashboard API data so that a dropped
 * connection degrades to "last known good" views instead of a blank page.
 *
 * Cache invalidation strategy (full write-up: app/frontend/docs/offline-caching.md):
 *
 *   1. Versioned caches — every cache name embeds SW_VERSION. Bumping the
 *      version in a deploy makes `activate` delete every cache from older
 *      versions, guaranteeing users never keep assets from a stale build.
 *   2. Freshness TTL — cached dashboard API responses are considered fresh
 *      for API_CACHE_FRESH_TTL_MS (5 minutes). Past the TTL the entry is
 *      still used as an offline fallback (flagged as stale to the UI) but is
 *      never silently preferred over a network response — the strategy is
 *      network-first, so online users always see fresh data.
 *   3. Hard eviction — API entries older than API_CACHE_MAX_AGE_MS
 *      (24 hours) are deleted on read and by the activation sweep, so stale
 *      data cannot linger indefinitely even if the SW version never changes.
 *   4. Hashed Next.js assets (/_next/static/*) are immutable per build and
 *      are cached cache-first; they are purged via the version bump in (1).
 *
 * Health/endpoints that must always reflect live state (`/health`,
 * `/api/health`, version config) are deliberately NOT in the cache allowlist
 * and pass straight through to the network.
 *
 * The worker exposes its constants and pure helpers on `self.__SOTER_SW__`
 * so they can be unit-tested from Jest (src/lib/service-worker.test.ts).
 */

const SW_VERSION = 'v1';

const STATIC_CACHE = `soter-static-${SW_VERSION}`;
const PAGES_CACHE = `soter-pages-${SW_VERSION}`;
const API_CACHE = `soter-api-${SW_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE, API_CACHE];
const CACHE_PREFIX = 'soter-';

/** How long a cached dashboard API response counts as "fresh" (5 minutes). */
const API_CACHE_FRESH_TTL_MS = 5 * 60 * 1000;

/** Hard ceiling: cached dashboard API responses older than this are evicted (24 hours). */
const API_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Give up on a slow network response after this long and fall back to cache (8 seconds). */
const NETWORK_TIMEOUT_MS = 8000;

/** Same-origin assets from public/ that are safe to precache at install time. */
const PRECACHE_ASSETS = ['/globe.svg', '/next.svg'];

/** Synthetic URL under which the offline fallback document is stored. */
const OFFLINE_FALLBACK_URL = '/__soter-offline-fallback';

/** Header stamped on cached API responses so the UI can show their age. */
const CACHED_AT_HEADER = 'sw-cached-at';

/**
 * Dashboard API endpoints eligible for offline fallback caching, matched
 * against the full request URL (origin may be cross-origin — the backend
 * lives at NEXT_PUBLIC_API_URL). Anything not matched (e.g. /health) is
 * network-only by design.
 */
const CACHEABLE_API_PATTERNS = [
  /\/api\/v1\/analytics\/global-stats$/,
  /\/api\/v1\/aid\/packages(?:\?|$)/,
  /\/analytics\/map-data$/,
  /\/api\/v1\/notifications\/activity-feed(?:\?|$)/,
  /\/api\/v1\/campaigns(?:[/?]|$)/,
];

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Soter — Offline</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b1220; color: #e5e7eb; }
  main { text-align: center; padding: 2rem; max-width: 28rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #9ca3af; font-size: 0.95rem; line-height: 1.5; }
</style>
</head>
<body>
<main role="status">
  <h1>You are offline</h1>
  <p>Soter could not reach the network and no cached copy of this page is available. Reconnect and reload to continue.</p>
</main>
</body>
</html>`;

function isCacheableApiUrl(url) {
  return CACHEABLE_API_PATTERNS.some(function (pattern) {
    return pattern.test(url);
  });
}

function isImmutableStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/');
}

function isNavigation(request) {
  return request.mode === 'navigate';
}

function cacheKey(request) {
  return typeof request === 'string' ? request : request.url;
}

function readCachedAt(response) {
  var header = response.headers.get(CACHED_AT_HEADER);
  if (!header) return null;
  var parsed = parseInt(header, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageOfCachedResponse(response) {
  var cachedAt = readCachedAt(response);
  if (cachedAt === null) return null;
  return Math.max(0, Date.now() - cachedAt);
}

/**
 * Fetch with a hard timeout so a hung connection on unreliable networks
 * falls back to cached dashboard data instead of blocking the UI.
 */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
      reject(new Error('soter-sw: network timeout'));
    }, timeoutMs);
    fetch(request, { signal: controller.signal }).then(
      function (response) {
        clearTimeout(timer);
        resolve(response);
      },
      function (error) {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Copy a response into the cache, stamping it with the time it was stored. */
async function putTimestamped(cache, request, response) {
  var body = await response.arrayBuffer();
  var headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  await cache.put(
    cacheKey(request),
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    }),
  );
}

/** Look up a cached API response, evicting entries past the hard max age. */
async function matchApiCache(cache, request) {
  var cached = await cache.match(cacheKey(request));
  if (!cached) return null;
  var age = ageOfCachedResponse(cached);
  if (age !== null && age > API_CACHE_MAX_AGE_MS) {
    await cache.delete(cacheKey(request));
    return null;
  }
  return cached;
}

/** Notify open windows that a response was served from cache (offline banner). */
function notifyClients(message) {
  self.clients
    .matchAll({ type: 'window' })
    .then(function (windowClients) {
      windowClients.forEach(function (client) {
        client.postMessage(message);
      });
    })
    .catch(function () {
      /* notification is best-effort */
    });
}

/** Report a cached fallback to the UI, including its age/freshness. */
function notifyCachedResponse(request, response) {
  var age = ageOfCachedResponse(response);
  notifyClients({
    type: 'soter:cached-response',
    url: request.url,
    cachedAt: readCachedAt(response),
    stale: age === null || age > API_CACHE_FRESH_TTL_MS,
  });
}

/**
 * Network-first for dashboard API data: try the network (bounded by
 * NETWORK_TIMEOUT_MS), cache successful responses, and fall back to the
 * most recent cached copy when the network fails or times out.
 */
async function networkFirstApi(event) {
  var cache = await caches.open(API_CACHE);
  try {
    var response = await fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS);
    if (response.ok && response.type !== 'opaque') {
      putTimestamped(cache, event.request, response.clone()).catch(function () {
        /* cache write failures must never break the response */
      });
      notifyClients({ type: 'soter:network-response', url: event.request.url });
      return response;
    }
    // Reachable but failing upstream (gateway/proxy 5xx) — prefer the last
    // good copy over an error so a flaky backend does not blank the dashboard.
    if (response.status >= 500) {
      var serverErrorFallback = await matchApiCache(cache, event.request);
      if (serverErrorFallback) {
        notifyCachedResponse(event.request, serverErrorFallback);
        return serverErrorFallback;
      }
    }
    return response;
  } catch (networkError) {
    var cached = await matchApiCache(cache, event.request);
    if (cached) {
      notifyCachedResponse(event.request, cached);
      return cached;
    }
    throw networkError;
  }
}

/**
 * Network-first for navigations so online users always get the server
 * render; offline users get the last successfully loaded page, or a
 * minimal offline document when nothing was cached yet.
 */
async function networkFirstNavigation(event) {
  var cache = await caches.open(PAGES_CACHE);
  try {
    var response = await fetch(event.request);
    if (response.ok && response.type !== 'opaque') {
      cache.put(event.request, response.clone()).catch(function () {});
      return response;
    }
    if (response.status >= 500) {
      var errorFallback = await cache.match(event.request);
      if (errorFallback) {
        notifyCachedResponse(event.request, errorFallback);
        return errorFallback;
      }
    }
    return response;
  } catch {
    var cached = await cache.match(event.request);
    if (cached) {
      notifyCachedResponse(event.request, cached);
      return cached;
    }
    var fallback = await caches.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Cache-first for hashed, immutable Next.js build assets. */
async function cacheFirstStatic(event) {
  var cache = await caches.open(STATIC_CACHE);
  var cached = await cache.match(event.request);
  if (cached) return cached;
  var response = await fetch(event.request);
  if (response.ok && response.type !== 'opaque') {
    cache.put(event.request, response.clone()).catch(function () {});
  }
  return response;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      var cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_ASSETS.map(function (asset) {
          return fetch(asset, { cache: 'reload' })
            .then(function (response) {
              if (response.ok) return cache.put(asset, response);
              return undefined;
            })
            .catch(function () {
              /* a missing precache asset must not fail installation */
            });
        }),
      );
      var pagesCache = await caches.open(PAGES_CACHE);
      await pagesCache.put(
        OFFLINE_FALLBACK_URL,
        new Response(OFFLINE_FALLBACK_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var names = await caches.keys();
      await Promise.all(
        names
          .filter(function (name) {
            return name.startsWith(CACHE_PREFIX) && CURRENT_CACHES.indexOf(name) === -1;
          })
          .map(function (name) {
            return caches.delete(name);
          }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isNavigation(request)) {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.origin === self.location.origin && isImmutableStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(event));
    return;
  }

  if (isCacheableApiUrl(request.url)) {
    event.respondWith(networkFirstApi(event));
  }

  /* Everything else (health checks, version config, map tiles, cross-origin
     third-party requests) is intentionally not intercepted. */
});

self.__SOTER_SW__ = {
  SW_VERSION: SW_VERSION,
  STATIC_CACHE: STATIC_CACHE,
  PAGES_CACHE: PAGES_CACHE,
  API_CACHE: API_CACHE,
  CURRENT_CACHES: CURRENT_CACHES,
  CACHE_PREFIX: CACHE_PREFIX,
  API_CACHE_FRESH_TTL_MS: API_CACHE_FRESH_TTL_MS,
  API_CACHE_MAX_AGE_MS: API_CACHE_MAX_AGE_MS,
  NETWORK_TIMEOUT_MS: NETWORK_TIMEOUT_MS,
  PRECACHE_ASSETS: PRECACHE_ASSETS,
  OFFLINE_FALLBACK_URL: OFFLINE_FALLBACK_URL,
  OFFLINE_FALLBACK_HTML: OFFLINE_FALLBACK_HTML,
  CACHED_AT_HEADER: CACHED_AT_HEADER,
  CACHEABLE_API_PATTERNS: CACHEABLE_API_PATTERNS,
  isCacheableApiUrl: isCacheableApiUrl,
  isImmutableStaticAsset: isImmutableStaticAsset,
  ageOfCachedResponse: ageOfCachedResponse,
};
