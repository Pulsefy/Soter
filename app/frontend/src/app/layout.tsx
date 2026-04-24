import { Geist, Geist_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';
import { Navbar } from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { locales } from '@/i18n';

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
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // Ensure that the incoming `locale` is valid
  if (!locales.includes(locale as any)) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen bg-white text-blue-900 dark:bg-slate-950 dark:text-slate-50`}
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <ErrorBoundary>
              <QueryProvider>
                <ToastProvider>
                  <Navbar />
                  {children}
                </ToastProvider>
              </QueryProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
