import { Geist, Geist_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';
import { Navbar } from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';
import TestnetFaucetHelper from '@/components/systems/TestnetFaucetHelper';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MisconfiguredPage } from '@/components/MisconfiguredPage';
import { EnvWarningBanner } from '@/components/EnvWarningBanner';
import { VersionProvider } from '@/components/VersionProvider';
import { validateEnv } from '@/lib/env';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Soter - Transparent Aid, Directly Delivered',
  description:
    'Open-source, privacy-first platform on Stellar blockchain empowering direct humanitarian aid distribution with AI verification and immutable transparency.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fail fast: validate required environment variables before rendering anything.
  // This runs server-side only; no secret values are forwarded to the client.
  const envResult = validateEnv();
  const isProduction = process.env.NODE_ENV === 'production';

  if (!envResult.ok && isProduction) {
    return (
      <MisconfiguredPage
        missing={envResult.missing}
        invalid={envResult.invalid}
      />
    );
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-background text-foreground antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <ErrorBoundary>
              <VersionProvider>
                <QueryProvider>
                  <ToastProvider>
                    {!envResult.ok && <EnvWarningBanner missing={envResult.missing} invalid={envResult.invalid} />}
                    <Navbar />
                    {children}
                  </ToastProvider>
                </QueryProvider>
              </VersionProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
