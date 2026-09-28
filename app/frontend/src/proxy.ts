import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { locales } from './i18n';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale: 'en',
  localeDetection: true,
});

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProduction = process.env.NODE_ENV === 'production';
  const allowDemos = process.env.NEXT_PUBLIC_ENABLE_DEMOS === 'true';

  const isDemoRoute =
    pathname.includes('/demo-version') ||
    pathname.includes('/demo-checklist') ||
    pathname.includes('/admin-biometric-demo');

  if (isProduction && isDemoRoute && !allowDemos) {
    return NextResponse.rewrite(new URL('/404', request.url), { status: 404 });
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/', '/(en|es|fr)/:path*'],
};
