import createMiddleware from 'next-intl/middleware';
import { locales } from './i18n';

export default createMiddleware({
  // A list of all locales that are supported
  locales,

  // Used when no locale matches
  defaultLocale: 'en'
});

export const config = {
  // Match only internationalized pathnames
  matcher: [
    // Enable a redirect to a matching locale at the root
    '/',

    // Set a cookie to remember the previous locale for
    // all requests that have a locale prefix
    '/(en|es|fr)/:path*',

    // Enable redirects that add a locale prefix to all other requests,
    // excluding api, _next and public files
    '/((?!api|_next|_vercel|.*\\..*).*)'
  ]
};
