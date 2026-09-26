import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getLocale,
  initializeLocale,
  locales,
  setLocale,
  Locale,
} from '../i18n';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALE_KEY = '@soter/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LanguageConfig {
  /** Currently active locale code ('en' | 'es' | 'fr') */
  locale: Locale;
  /** Locale detected from the device at startup */
  deviceLocale: Locale;
  /** All supported locales */
  locales: readonly Locale[];
  /** Whether the user has explicitly chosen a locale (vs device default) */
  isOverridden: boolean;
  /**
   * Set the active locale. Pass the detected `deviceLocale` to "follow the
   * device", or any other supported code to override it.
   */
  setActiveLocale: (locale: Locale) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LanguageContext = createContext<LanguageConfig | undefined>(undefined);

const readStoredLocale = async (): Promise<Locale | null> => {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_KEY);
    if (stored && (locales as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // Ignore storage failures; fall back to device default.
  }
  return null;
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const deviceLocale = useMemo(() => initializeLocale(), []);
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);
  const [isOverridden, setIsOverridden] = useState(false);

  useEffect(() => {
    let active = true;
    readStoredLocale().then((stored) => {
      if (!active) return;
      if (stored && stored !== deviceLocale) {
        setLocale(stored);
        setLocaleState(stored);
        setIsOverridden(true);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActiveLocale = useCallback(
    async (next: Locale) => {
      setLocale(next);
      setLocaleState(next);
      setIsOverridden(next !== deviceLocale);
      try {
        if (next === deviceLocale) {
          await AsyncStorage.removeItem(LOCALE_KEY);
        } else {
          await AsyncStorage.setItem(LOCALE_KEY, next);
        }
      } catch {
        // Non-fatal — the override still applies for this session.
      }
    },
    [deviceLocale],
  );

  const value = useMemo<LanguageConfig>(
    () => ({
      locale,
      deviceLocale,
      locales,
      isOverridden,
      setActiveLocale,
    }),
    [locale, deviceLocale, isOverridden, setActiveLocale],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageConfig => {
  const ctx = useContext(LanguageContext);
  if (ctx === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
};