'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect, useTransition } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { useLocaleStore } from '@/lib/localeStore';
import type { Locale } from '@/i18n';

const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

export function LanguageSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale() as Locale;
  const { locale: storedLocale, setLocale } = useLocaleStore();
  const [isPending, startTransition] = useTransition();

  // On mount: if the user previously chose a different locale, restore it by
  // navigating to the stored locale's path so the URL and store stay in sync.
  useEffect(() => {
    if (storedLocale && storedLocale !== currentLocale) {
      startTransition(() => {
        const segments = pathname.split('/');
        segments[1] = storedLocale;
        router.replace(segments.join('/'));
      });
    }
    // Only run on mount — exhaustive-deps intentionally omitted for storedLocale
    // and currentLocale because we only want the initial sync, not a reactive loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === currentLocale) return;

    startTransition(() => {
      setLocale(newLocale);

      const segments = pathname.split('/');
      segments[1] = newLocale;
      router.push(segments.join('/'));
    });
  };

  return (
    <div className="relative">
      <select
        value={currentLocale}
        onChange={(e) => handleLocaleChange(e.target.value as Locale)}
        disabled={isPending}
        className="appearance-none bg-transparent border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50"
        aria-label="Select language"
      >
        {Object.entries(localeNames).map(([locale, name]) => (
          <option key={locale} value={locale}>
            {name}
          </option>
        ))}
      </select>

      {/* Show a spinner while navigating, globe icon otherwise */}
      {isPending ? (
        <Loader2
          size={16}
          className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-blue-500 pointer-events-none"
          aria-hidden="true"
        />
      ) : (
        <Globe
          size={16}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
          aria-hidden="true"
        />
      )}
    </div>
  );
}