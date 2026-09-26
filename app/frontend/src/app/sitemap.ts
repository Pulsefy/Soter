import { MetadataRoute } from 'next';

import { locales } from '@/i18n';

// Routes that actually exist under src/app/[locale]. Keep in sync with that directory.
const PUBLIC_ROUTES = [
  '',
  '/dashboard',
  '/campaigns',
  '/claim-receipt',
  '/help',
  '/verification-review',
] as const;

// Contributor-facing demo surfaces. Excluded from production sitemaps (#910).
const DEMO_ROUTES = [
  '/demo-version',
  '/demo-checklist',
  '/admin-biometric-demo',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://soter.pulsefy.app';
  const isProduction = process.env.NODE_ENV === 'production';

  const routes: readonly string[] = isProduction
    ? PUBLIC_ROUTES
    : [...PUBLIC_ROUTES, ...DEMO_ROUTES];

  const lastModified = new Date();

  // next-intl runs with the default localePrefix ('always'), so every route is
  // served under a locale segment. Emit one entry per locale and cross-link them
  // with hreflang alternates.
  return locales.flatMap(locale =>
    routes.map(route => ({
      url: `${baseUrl}/${locale}${route}`,
      lastModified,
      changeFrequency: 'daily' as const,
      priority: route === '' ? 1.0 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          locales.map(alt => [alt, `${baseUrl}/${alt}${route}`])
        ),
      },
    }))
  );
}
