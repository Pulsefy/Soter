/**
 * React hook that re-renders the component when the active locale changes and
 * exposes the i18n `t` function. Screens should call `useTranslation()` and
 * route every user-facing string through `t(...)`.
 */

import { useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

import {
  t,
  Locale,
  DEFAULT_LOCALE,
  hasTranslation,
  reportMissingTranslation,
} from './index';

export interface Translation {
  t: (key: string, params?: Record<string, unknown>) => string;
  locale: Locale;
}

export function useTranslation(): Translation {
  const { locale } = useLanguage();
  // `locale` is read so the hook subscribes to language changes and
  // re-renders the wrapping screen when the user switches locale.
  const translate = useCallback(
    (key: string, params?: Record<string, unknown>) => {
      return t(key, { locale, ...params });
    },
    [locale],
  );

  return { t: translate, locale };
}

export { formatCurrency, formatDate, formatNumber, formatRelativeDate } from './formatters';
export { DEFAULT_LOCALE, hasTranslation, reportMissingTranslation } from './index';
export type { Locale } from './index';
