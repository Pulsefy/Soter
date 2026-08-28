import type { MetadataRoute } from 'next';
import { locales } from '@/i18n';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://soter.pulsefy.app';
  const isProduction = process.env.NODE_ENV === 'production';

  const baseRoutes = ['', '/dashboard', '/settings'];

  const demoRoutes = [
    '/demo-version',
    '/demo-checklist',
    '/admin-biometric-demo',
  ];

  const routes = isProduction ? baseRoutes : [...baseRoutes, ...demoRoutes];

  return locales.flatMap(locale =>
    routes.map(route => ({
      url: `${baseUrl}/${locale}${route}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: route === '' ? 1.0 : 0.8,
    })),
  );
}
