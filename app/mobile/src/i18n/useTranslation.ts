/**
 * React hook that re-renders the component when the active locale changes and
 * exposes the i18n `t` function. Screens should call `useTranslation()` and
 * route every user-facing string through `t(...)`.
 */

import { useLanguage } from '../contexts/LanguageContext';

import { t, Locale } from './index';

export interface Translation {
  t: typeof t;
  locale: Locale;
}

export function useTranslation(): Translation {
  const { locale } = useLanguage();
  // `locale` is read so the hook subscribes to language changes and
  // re-renders the wrapping screen when the user switches locale.
  return { t, locale };
}

export { formatCurrency, formatDate, formatNumber, formatRelativeDate } from './formatters';
export type { Locale } from './index';