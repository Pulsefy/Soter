import createMiddleware from 'next-intl/middleware';
import { locales } from './i18n';

export default createMiddleware({
  // A list of all locales that are supported
  locales,

  // Used when no locale matches
  defaultLocale: 'en',

  // Automatically detect the user's locale based on:
  // 1. The `Accept-Language` header
  // 2. The locale cookie
  // 3. The pathname
  localeDetection: true,
});

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(en|es|fr)/:path*'],
};