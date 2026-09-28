import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProduction = process.env.NODE_ENV === 'production';
  const allowDemos = process.env.NEXT_PUBLIC_ENABLE_DEMOS === 'true';

  // Identify demo paths under app/[locale]/
  const isDemoRoute =
    pathname.includes('/demo-version') ||
    pathname.includes('/demo-checklist') ||
    pathname.includes('/admin-biometric-demo');

  if (isProduction && isDemoRoute && !allowDemos) {
    // Return a 404 response in production builds
    return NextResponse.rewrite(new URL('/404', request.url), { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/:locale/demo-version',
    '/:locale/demo-checklist',
    '/:locale/admin-biometric-demo',
    '/:locale/:path*',
  ],
};
