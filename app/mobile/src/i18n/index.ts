/**
 * Mobile localization core.
 *
 * Wraps `i18n-js` and mirrors the web frontend's `en` / `es` / `fr` catalogs.
 * The active locale follows the device setting by default, and can be
 * overridden at runtime via [`setLocale`] (used by the in-app language picker
 * in Settings).
 *
 * See `src/i18n/formatters.ts` for locale-aware date/number/currency output,
 * and `tests/i18n.test.ts` for the CI-facing checks.
 */

import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';

import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';

export const locales = ['en', 'es', 'fr'] as const;
export type Locale = (typeof locales)[number];

const messages: Record<Locale, Record<string, unknown>> = { en, es, fr };

const i18n = new I18n(messages);

i18n.defaultLocale = 'en';
i18n.enableFallback = true;

/** Align the active locale with the device setting (called at app start). */
export function initializeLocale(): Locale {
  const deviceLocale = getLocales()[0]?.languageCode ?? 'en';
  setLocale(locales.includes(deviceLocale as Locale) ? deviceLocale : 'en');
  return getLocale();
}

/** Override the active locale at runtime (in-app language picker). */
export function setLocale(locale: Locale): void {
  i18n.locale = locale;
}

/** Return the currently active locale code. */
export function getLocale(): Locale {
  return (i18n.locale as Locale) ?? 'en';
}

/**
 * Translate a dot-namespaced key (e.g. `home.title`).
 *
 * Falls back to the raw key when a locale is missing a translation, matching
 * the web frontend's `getMessageFallback` behaviour so the UI stays usable
 * during active translation work.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  const value = i18n.t(key, params);
  return typeof value === 'string' ? value : key;
}

/** Whether the given key resolves to a real translation in `locale`. */
export function hasTranslation(
  locale: Locale,
  key: string,
  params?: Record<string, unknown>,
): boolean {
  const value = new I18n(messages).t(key, { locale, ...params });
  return typeof value === 'string' && value !== key;
}

export default i18n;