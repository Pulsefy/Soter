import { Geist, Geist_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';
import { Navbar } from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider'; // Import ThemeProvider
import { ErrorBoundary } from '@/components/ErrorBoundary';

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is needed when using 'class' strategy with next-themes
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen bg-white text-blue-900 dark:bg-slate-950 dark:text-slate-50`}
      >
        <ThemeProvider> {/* Wrap with ThemeProvider */}
        <ErrorBoundary>
          <QueryProvider>
            <ToastProvider>
              <Navbar />
              {children}
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
