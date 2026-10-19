# Offline Caching & Service Worker (Web)

Soter's web dashboard is used in the field and over unreliable connectivity.
This document describes how the frontend keeps working when the network drops,
and — critically — how cached data is invalidated so stale data never lingers
indefinitely.

Related issue: **#1345**.

## Goals

1. Cache the application shell (static assets and the last successfully loaded
   navigations) so a dropped connection never produces a blank page.
2. Cache the most recently fetched dashboard API data and show it with a clear
   **"offline, showing cached data"** indicator.
3. Refresh silently when connectivity returns — no skeleton flash, no user
   action required.
4. Keep cache invalidation explicit and bounded so stale data cannot persist
   forever.

## Files

| File | Responsibility |
| --- | --- |
| `public/sw.js` | The service worker: install/activate lifecycle and all fetch strategies. |
| `src/lib/offline-status.ts` | Zustand store tracking connectivity and whether the SW is serving cache. |
| `src/hooks/useOfflineStatus.ts` | React hook wrapping the store (`useSyncExternalStore`). |
| `src/components/offline/OfflineIndicator.tsx` | The "offline, showing cached data" banner. |
| `src/components/offline/ServiceWorkerRegistration.tsx` | Registers `/sw.js` and starts connectivity tracking. |
| `src/components/dashboard/DashboardSummaryCards.tsx` | Also refetches on `online` while keeping the last figures on screen. |

The worker is registered from the root layout (`src/app/layout.tsx`),
production builds only. `next.config.ts` needs no changes: `public/sw.js` is
served at the site root, which gives it the default `/` scope.

## Request strategies

| Request type | Strategy | Why |
| --- | --- | --- |
| Navigations (HTML) | Network-first, cached-page fallback, then a minimal offline document | Online users always get a server render; offline users get their last view instead of an error. |
| `/_next/static/*` | Cache-first | Filenames are content-hashed and immutable per build. |
| Dashboard API (`/api/v1/analytics/global-stats`, `/api/v1/aid/packages`, `/analytics/map-data`, `/api/v1/notifications/activity-feed`, `/api/v1/campaigns`) | Network-first with an 8 s timeout, cached-response fallback | Field connectivity is slow and flaky; a hung request must not block the dashboard. Successful responses refresh the cache; failures fall back to the last good copy. |
| Health checks (`/health`, `/api/health`), version config (`/api/v1/config/version`), map tiles, other origins | Not intercepted | These must always reflect live state. |

Only `GET` requests are ever handled.

### Cached-data signalling

When the worker serves a response from cache it posts a
`soter:cached-response` message to every open window with the URL, the
`cachedAt` timestamp and a `stale` flag. `src/lib/offline-status.ts` turns that
into `isServingCachedData`, which is what the banner renders. When a live
response lands, the worker posts `soter:network-response` and the flag clears.

This is why the banner also appears when `navigator.onLine` is `true` but the
backend is unreachable: the browser thinks it is online, but the data on
screen is cached.

## Cache invalidation strategy

There are four independent layers. Together they bound how stale cached data
can become.

### 1. Versioned caches (safe deploys)

Every cache name embeds `SW_VERSION`:

```
soter-static-v1
soter-pages-v1
soter-api-v1
```

On `activate`, the worker deletes every `soter-*` cache whose name is not in
`CURRENT_CACHES`. **To invalidate all cached data after a deploy, bump
`SW_VERSION` in `public/sw.js`.** Users receive the new worker on their next
page load; it skips waiting, claims open clients, and purges the old caches. A
version bump is also the mechanism that clears stale hashed build assets.

### 2. Freshness TTL (5 minutes)

`API_CACHE_FRESH_TTL_MS` (5 minutes) is the window in which a cached API
response is considered fresh. The strategy is network-first, so online users
always get live data; the TTL only marks a cache fallback as `stale` so the UI
and diagnostics can distinguish "just cached" from "cached a while ago".

### 3. Hard eviction (24 hours)

`API_CACHE_MAX_AGE_MS` (24 hours) is a hard ceiling. Cached API responses older
than this are **deleted on read and never served**, so even if `SW_VERSION` is
never bumped a day-old metric cannot be shown. Because the worker is
network-first, an online request replaces the entry well before this applies;
the ceiling only matters for devices that have been offline for a long time.

### 4. Server-error handling

If the backend is reachable but returns a 5xx (gateway/proxy error), the worker
prefers the last cached copy over the error, so a flaky backend degrades to
cached data with the offline indicator rather than a broken dashboard. Non-5xx
errors (e.g. 400/404) are passed through unchanged.

### Manual invalidation

| Goal | Action |
| --- | --- |
| Purge everything for all users | Bump `SW_VERSION` in `public/sw.js` |
| Change what is cacheable | Update `CACHEABLE_API_PATTERNS` in `public/sw.js` (then bump the version) |
| Change a caching strategy | Edit `public/sw.js` (then bump the version) |
| Purge locally while debugging | DevTools → Application → Service Workers → Unregister, then clear Storage |

## Reconnect behaviour (silent refresh)

- The service worker is network-first, so the first request after reconnect
  fetches fresh data and rewrites the cache with no UI change.
- React Query's default `refetchOnReconnect` refetches active queries when the
  browser reports the connection is back.
- `DashboardSummaryCards` (which uses a plain `fetch`, not React Query)
  listens for the `online` event and refetches. It only shows a loading
  skeleton on the **first** load — reconnect refreshes keep the last figures
  on screen until new data replaces them. If the refresh fails, the last-known
  figures remain and the offline banner explains why.

## Development & testing

- `next dev` does **not** register the worker (Turbopack chunk URLs are
  unstable). The offline banner still works in development because it is
  driven by `navigator.onLine` and SW messages only.
- To test offline behaviour, run a production build (`pnpm build && pnpm
  start`), load the dashboard, then use DevTools → Network → **Offline** and
  reload. The last dashboard values should render with the banner.
- Unit tests:
  - `src/lib/service-worker.test.ts` loads the real `public/sw.js` in a VM with
    mocked `self`/`caches`/`fetch` and verifies the strategies and invalidation
    rules.
  - `src/lib/offline-status.test.ts` covers connectivity and SW-message
    handling.
  - `src/components/offline/__tests__/OfflineIndicator.test.tsx` covers the
    banner states.
  - `src/components/dashboard/DashboardSummaryCards.test.tsx` covers the
    silent reconnect refresh.

## Adding a new cacheable endpoint

1. Add a pattern to `CACHEABLE_API_PATTERNS` in `public/sw.js`.
2. Bump `SW_VERSION`.
3. Add a case to `src/lib/service-worker.test.ts` asserting the endpoint is
   allowlisted and that health-like endpoints are not.
