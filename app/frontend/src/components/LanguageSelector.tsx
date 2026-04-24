'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { Globe } from 'lucide-react';
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
  const { setLocale } = useLocaleStore();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === currentLocale) return;

    startTransition(() => {
      // Update the locale in the store
      setLocale(newLocale);

      // Navigate to the new locale
      const newPath = pathname.replace(`/${currentLocale}`, `/${newLocale}`);
      router.push(newPath);
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
      <Globe
        size={16}
        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
      />
    </div>
  );
}