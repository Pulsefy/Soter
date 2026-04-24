import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from '@/i18n';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'locale-storage',
    }
  )
);