# Demo Routes Gating Policy

To maintain production security and cleanliness, all mock or demonstration pages created under `src/app/[locale]/` must be explicitly gated.

## Adding a New Demo Route
1. Prefix or name your route containing keywords like `demo-` or ensure it matches the middleware matcher pattern.
2. Update `src/middleware.ts` if introducing a new path prefix that requires production exclusion.
3. Verify that sitemap generators filter out the path when `NODE_ENV === 'production'`.
4. To test demo routes locally in production mode, set `NEXT_PUBLIC_ENABLE_DEMOS=true` in your local `.env.local` file.