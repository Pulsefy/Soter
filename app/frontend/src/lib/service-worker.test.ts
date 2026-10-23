/**
 * @jest-environment node
 *
 * Loads the real `public/sw.js` in an isolated VM context with mocked
 * service-worker globals (self, caches, fetch) and exercises its caching
 * strategies and invalidation rules. Testing the shipped file (rather than a
 * re-implementation) keeps these assertions honest.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface SoterServiceWorkerApi {
  SW_VERSION: string;
  STATIC_CACHE: string;
  PAGES_CACHE: string;
  API_CACHE: string;
  CURRENT_CACHES: string[];
  CACHE_PREFIX: string;
  API_CACHE_FRESH_TTL_MS: number;
  API_CACHE_MAX_AGE_MS: number;
  NETWORK_TIMEOUT_MS: number;
  PRECACHE_ASSETS: string[];
  OFFLINE_FALLBACK_URL: string;
  OFFLINE_FALLBACK_HTML: string;
  CACHED_AT_HEADER: string;
  CACHEABLE_API_PATTERNS: RegExp[];
  isCacheableApiUrl: (url: string) => boolean;
  isImmutableStaticAsset: (url: URL) => boolean;
  ageOfCachedResponse: (response: Response) => number | null;
}

interface SwHarness {
  api: SoterServiceWorkerApi;
  listeners: Record<string, (event: unknown) => void>;
  caches: Map<string, Map<string, Response>>;
  postedMessages: Array<Record<string, unknown>>;
  fetchMock: jest.Mock;
  clientsClaim: jest.Mock;
  skipWaiting: jest.Mock;
}

const SW_PATH = path.resolve(__dirname, '../../public/sw.js');

function loadServiceWorker(): SwHarness {
  const code = fs.readFileSync(SW_PATH, 'utf8');
  const cacheStore = new Map<string, Map<string, Response>>();
  const postedMessages: Array<Record<string, unknown>> = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  const fetchMock = jest.fn();
  const clientsClaim = jest.fn().mockResolvedValue(undefined);
  const skipWaiting = jest.fn().mockResolvedValue(undefined);

  const keyOf = (request: unknown): string =>
    typeof request === 'string'
      ? request
      : (request as { url: string }).url;

  const openCache = (name: string) => {
    if (!cacheStore.has(name)) cacheStore.set(name, new Map());
    const entries = cacheStore.get(name)!;
    return {
      async match(request: unknown) {
        const hit = entries.get(keyOf(request));
        return hit ? hit.clone() : undefined;
      },
      async put(request: unknown, response: Response) {
        entries.set(keyOf(request), response);
      },
      async delete(request: unknown) {
        return entries.delete(keyOf(request));
      },
      async keys() {
        return [...entries.keys()];
      },
    };
  };

  const cachesMock = {
    async open(name: string) {
      return openCache(name);
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    },
    async match(request: unknown) {
      for (const entries of cacheStore.values()) {
        const hit = entries.get(keyOf(request));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };

  const selfMock = {
    location: { origin: 'http://localhost:3000' },
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners[type] = listener;
    },
    skipWaiting,
    clients: {
      claim: clientsClaim,
      matchAll: jest
        .fn()
        .mockResolvedValue([
          { postMessage: (message: Record<string, unknown>) => postedMessages.push(message) },
        ]),
    },
  };

  const sandbox = {
    self: selfMock,
    caches: cachesMock,
    fetch: fetchMock,
    Response,
    Request,
    Headers,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return {
    api: (selfMock as unknown as { __SOTER_SW__: SoterServiceWorkerApi }).__SOTER_SW__,
    listeners,
    caches: cacheStore,
    postedMessages,
    fetchMock,
    clientsClaim,
    skipWaiting,
  };
}

/** Wait for queued microtasks (postMessage notifications, background cache writes). */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

interface CapturedEvent {
  request: Request;
  respondWith: jest.Mock;
  waitUntil: jest.Mock;
}

function fetchEvent(request: Request): CapturedEvent {
  return { request, respondWith: jest.fn(), waitUntil: jest.fn() };
}

function navigationRequest(url: string): Request {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

function cachedResponseWithAge(body: string, ageMs: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'sw-cached-at': String(Date.now() - ageMs),
    },
  });
}

const GLOBAL_STATS_URL = 'http://localhost:4000/api/v1/analytics/global-stats';

describe('public/sw.js', () => {
  let sw: SwHarness;

  beforeEach(() => {
    sw = loadServiceWorker();
  });

  describe('cache invalidation configuration', () => {
    it('exposes versioned cache names', () => {
      expect(sw.api.SW_VERSION).toBe('v1');
      expect(sw.api.STATIC_CACHE).toContain(sw.api.SW_VERSION);
      expect(sw.api.PAGES_CACHE).toContain(sw.api.SW_VERSION);
      expect(sw.api.API_CACHE).toContain(sw.api.SW_VERSION);
    });

    it('evicts stale API data well before the freshness window can grow unbounded', () => {
      expect(sw.api.API_CACHE_MAX_AGE_MS).toBeGreaterThan(sw.api.API_CACHE_FRESH_TTL_MS);
      expect(sw.api.API_CACHE_FRESH_TTL_MS).toBe(5 * 60 * 1000);
      expect(sw.api.API_CACHE_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('only allowlists dashboard endpoints, never health checks', () => {
      expect(sw.api.isCacheableApiUrl(GLOBAL_STATS_URL)).toBe(true);
      expect(sw.api.isCacheableApiUrl('http://localhost:4000/analytics/map-data')).toBe(true);
      expect(sw.api.isCacheableApiUrl('http://localhost:4000/api/v1/aid/packages?page=1')).toBe(true);
      expect(sw.api.isCacheableApiUrl('http://localhost:4000/health')).toBe(false);
      expect(sw.api.isCacheableApiUrl('http://localhost:4000/api/health')).toBe(false);
      expect(sw.api.isCacheableApiUrl('http://localhost:4000/api/v1/config/version')).toBe(false);
    });
  });

  describe('install', () => {
    it('precaches the app shell and stores the offline fallback document', async () => {
      sw.fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('asset', { status: 200 })),
      );

      let installPromise: Promise<unknown> | undefined;
      sw.listeners.install({ waitUntil: (promise: Promise<unknown>) => (installPromise = promise) });
      await installPromise;
      await flush();

      expect(sw.fetchMock).toHaveBeenCalledWith('/globe.svg', { cache: 'reload' });
      expect(sw.api.PRECACHE_ASSETS).toContain('/next.svg');
      expect(sw.skipWaiting).toHaveBeenCalled();

      const fallback = sw.caches.get(sw.api.PAGES_CACHE)?.get(sw.api.OFFLINE_FALLBACK_URL);
      expect(fallback).toBeDefined();
      expect(await fallback!.text()).toContain('offline');
    });
  });

  describe('activate', () => {
    it('deletes caches from previous versions and claims clients', async () => {
      sw.caches.set('soter-api-v0', new Map());
      sw.caches.set(sw.api.API_CACHE, new Map());

      let activatePromise: Promise<unknown> | undefined;
      sw.listeners.activate({
        waitUntil: (promise: Promise<unknown>) => (activatePromise = promise),
      });
      await activatePromise;

      expect(sw.caches.has('soter-api-v0')).toBe(false);
      expect(sw.caches.has(sw.api.API_CACHE)).toBe(true);
      expect(sw.clientsClaim).toHaveBeenCalled();
    });
  });

  describe('dashboard API requests', () => {
    it('is network-first and caches fresh responses with a timestamp', async () => {
      sw.fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ totalAidDisbursed: 42 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const event = fetchEvent(new Request(GLOBAL_STATS_URL));
      sw.listeners.fetch(event);
      expect(event.respondWith).toHaveBeenCalledTimes(1);

      const response = await event.respondWith.mock.calls[0][0];
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ totalAidDisbursed: 42 });

      await flush();
      const cached = sw.caches.get(sw.api.API_CACHE)?.get(GLOBAL_STATS_URL);
      expect(cached).toBeDefined();
      expect(cached!.headers.get(sw.api.CACHED_AT_HEADER)).toBeTruthy();
      expect(sw.postedMessages).toContainEqual(
        expect.objectContaining({ type: 'soter:network-response', url: GLOBAL_STATS_URL }),
      );
    });

    it('falls back to the last cached data when the network fails, and tells the UI', async () => {
      sw.caches.set(
        sw.api.API_CACHE,
        new Map([[GLOBAL_STATS_URL, cachedResponseWithAge('{"totalAidDisbursed":7}', 60_000)]]),
      );
      sw.fetchMock.mockRejectedValue(new Error('offline'));

      const event = fetchEvent(new Request(GLOBAL_STATS_URL));
      sw.listeners.fetch(event);

      const response = await event.respondWith.mock.calls[0][0];
      expect(await response.json()).toEqual({ totalAidDisbursed: 7 });

      await flush();
      expect(sw.postedMessages).toContainEqual(
        expect.objectContaining({
          type: 'soter:cached-response',
          url: GLOBAL_STATS_URL,
          stale: false,
        }),
      );
    });

    it('flags cached fallbacks older than the freshness TTL as stale', async () => {
      sw.caches.set(
        sw.api.API_CACHE,
        new Map([[GLOBAL_STATS_URL, cachedResponseWithAge('{"totalAidDisbursed":3}', 10 * 60 * 1000)]]),
      );
      sw.fetchMock.mockRejectedValue(new Error('offline'));

      const event = fetchEvent(new Request(GLOBAL_STATS_URL));
      sw.listeners.fetch(event);
      await event.respondWith.mock.calls[0][0];
      await flush();

      expect(sw.postedMessages).toContainEqual(
        expect.objectContaining({ type: 'soter:cached-response', stale: true }),
      );
    });

    it('evicts entries older than the hard max age instead of serving them', async () => {
      sw.caches.set(
        sw.api.API_CACHE,
        new Map([
          [GLOBAL_STATS_URL, cachedResponseWithAge('{"totalAidDisbursed":1}', sw.api.API_CACHE_MAX_AGE_MS + 1)],
        ]),
      );
      sw.fetchMock.mockRejectedValue(new Error('offline'));

      const event = fetchEvent(new Request(GLOBAL_STATS_URL));
      sw.listeners.fetch(event);
      await expect(event.respondWith.mock.calls[0][0]).rejects.toThrow('offline');
      expect(sw.caches.get(sw.api.API_CACHE)?.has(GLOBAL_STATS_URL)).toBe(false);
    });

    it('prefers cached data over a gateway error so a flaky backend does not blank the dashboard', async () => {
      sw.caches.set(
        sw.api.API_CACHE,
        new Map([[GLOBAL_STATS_URL, cachedResponseWithAge('{"totalAidDisbursed":9}', 1000)]]),
      );
      sw.fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

      const event = fetchEvent(new Request(GLOBAL_STATS_URL));
      sw.listeners.fetch(event);
      const response = await event.respondWith.mock.calls[0][0];

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ totalAidDisbursed: 9 });
    });

    it('leaves uncacheable endpoints (health) on the network', () => {
      const event = fetchEvent(new Request('http://localhost:4000/health'));
      sw.listeners.fetch(event);
      expect(event.respondWith).not.toHaveBeenCalled();
    });
  });

  describe('navigations', () => {
    it('serves the last cached page when the network fails', async () => {
      const pageUrl = 'http://localhost:3000/en/dashboard';
      sw.caches.set(
        sw.api.PAGES_CACHE,
        new Map([[pageUrl, new Response('<html>cached</html>', { status: 200 })]]),
      );
      sw.fetchMock.mockRejectedValue(new Error('offline'));

      const event = fetchEvent(navigationRequest(pageUrl));
      sw.listeners.fetch(event);
      const response = await event.respondWith.mock.calls[0][0];

      expect(await response.text()).toContain('cached');
      await flush();
      expect(sw.postedMessages).toContainEqual(
        expect.objectContaining({ type: 'soter:cached-response', url: pageUrl }),
      );
    });

    it('serves the minimal offline document when no page was cached', async () => {
      sw.caches.set(
        sw.api.PAGES_CACHE,
        new Map([
          [
            sw.api.OFFLINE_FALLBACK_URL,
            new Response(sw.api.OFFLINE_FALLBACK_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
          ],
        ]),
      );
      sw.fetchMock.mockRejectedValue(new Error('offline'));

      const event = fetchEvent(navigationRequest('http://localhost:3000/en/dashboard'));
      sw.listeners.fetch(event);
      const response = await event.respondWith.mock.calls[0][0];

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect(await response.text()).toContain('You are offline');
    });
  });

  describe('static assets', () => {
    it('serves hashed build assets cache-first', async () => {
      const assetUrl = 'http://localhost:3000/_next/static/chunks/main-abc123.js';
      sw.caches.set(
        sw.api.STATIC_CACHE,
        new Map([[assetUrl, new Response('console.log(1)', { status: 200 })]]),
      );

      const event = fetchEvent(new Request(assetUrl));
      sw.listeners.fetch(event);
      const response = await event.respondWith.mock.calls[0][0];

      expect(await response.text()).toContain('console.log');
      expect(sw.fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('request filtering', () => {
    it('does not intercept non-GET requests', () => {
      const event = fetchEvent(new Request(GLOBAL_STATS_URL, { method: 'POST' }));
      sw.listeners.fetch(event);
      expect(event.respondWith).not.toHaveBeenCalled();
      expect(sw.fetchMock).not.toHaveBeenCalled();
    });
  });
});
