import { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  return routes.map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: route === '' ? 1.0 : 0.8,
  }));
}
