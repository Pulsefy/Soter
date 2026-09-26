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
import { captureError } from '../services/crashReporting';

import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';

export const locales = ['en', 'es', 'fr'] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const messages: Record<Locale, Record<string, any>> = { en, es, fr };

const i18n = new I18n(messages);

i18n.defaultLocale = DEFAULT_LOCALE;
i18n.enableFallback = true;

/** Align the active locale with the device setting (called at app start). */
export function initializeLocale(): Locale {
  try {
    const deviceLocale = getLocales()[0]?.languageCode ?? DEFAULT_LOCALE;
    setLocale(locales.includes(deviceLocale as Locale) ? (deviceLocale as Locale) : DEFAULT_LOCALE);
  } catch {
    setLocale(DEFAULT_LOCALE);
  }
  return getLocale();
}

/** Override the active locale at runtime (in-app language picker). */
export function setLocale(locale: Locale): void {
  i18n.locale = locale;
}

/** Return the currently active locale code. */
export function getLocale(): Locale {
  return (i18n.locale as Locale) ?? DEFAULT_LOCALE;
}

const reportedMissingKeys = new Set<string>();

export type MissingKeyReporter = (
  key: string,
  locale: Locale,
  fallbackLocale: Locale,
) => void;

let customReporter: MissingKeyReporter | null = null;

/** Register an optional callback for missing keys (useful for testing and monitoring). */
export function setMissingKeyReporter(reporter: MissingKeyReporter | null): void {
  customReporter = reporter;
}

/** Reset deduplication tracker (used between test runs). */
export function resetReportedMissingKeys(): void {
  reportedMissingKeys.clear();
}

/**
 * Report a missing translation key to crash/error reporting (e.g. Sentry)
 * and console warning in development. Deduplicated per session.
 */
export function reportMissingTranslation(
  key: string,
  locale: Locale,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): void {
  const dedupeKey = `${locale}:${key}`;
  if (reportedMissingKeys.has(dedupeKey)) {
    return;
  }
  reportedMissingKeys.add(dedupeKey);

  const message = `[i18n] Missing translation for key "${key}" in locale "${locale}". Falling back to "${fallbackLocale}".`;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(message);
  } else if (process.env.NODE_ENV === 'development') {
    console.warn(message);
  }

  try {
    const error = new Error(`Missing translation: [${locale}] ${key}`);
    error.name = 'MissingTranslationError';
    captureError(error, {
      key,
      locale,
      fallbackLocale,
      environment: process.env.NODE_ENV,
    });
  } catch {
    // Non-fatal — crash reporting failures must never impact user flow
  }

  if (customReporter) {
    try {
      customReporter(key, locale, fallbackLocale);
    } catch {
      // Non-fatal
    }
  }
}

/** Helper to retrieve raw string by dot-separated path from a locale dictionary. */
export function getRawTranslation(locale: Locale, key: string): string | undefined {
  const catalog = (i18n.translations as Record<string, any>)?.[locale] ?? messages[locale];
  if (!catalog || typeof catalog !== 'object') return undefined;

  const parts = key.split('.');
  let current: any = catalog;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return typeof current === 'string' ? current : undefined;
}

/** Replaces {token} placeholders within a translation template string. */
function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token) => {
    return params[token] !== undefined ? String(params[token]) : match;
  });
}

function isMissingResult(result: unknown): boolean {
  if (typeof result !== 'string') return true;
  return result.startsWith('[missing ') && result.endsWith(' translation]');
}

/**
 * Translate a dot-namespaced key (e.g. `home.title`).
 *
 * When a key is missing in the active locale:
 *  1. Reports the missing key to crash/error reporting (e.g. Sentry) in production.
 *  2. Falls back to the default locale's (`en`) translated string rather than
 *     rendering the raw key to the user.
 *  3. Only renders the raw key (or `params.defaultValue`) if the key is genuinely
 *     absent from both the active locale and the default fallback catalog.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  const activeLocale = (params?.locale as Locale) || getLocale();

  // 1. If active locale has the translation, return it interpolated
  if (hasTranslation(activeLocale, key, params)) {
    const value = i18n.t(key, { ...params, locale: activeLocale });
    if (typeof value === 'string' && !isMissingResult(value)) {
      return value;
    }
  }

  // 2. Active locale is missing this key — report it
  reportMissingTranslation(key, activeLocale, DEFAULT_LOCALE);

  // 3. Fall back to default locale if active locale is not the default locale
  if (activeLocale !== DEFAULT_LOCALE && hasTranslation(DEFAULT_LOCALE, key, params)) {
    const fallbackValue = i18n.t(key, { ...params, locale: DEFAULT_LOCALE });
    if (typeof fallbackValue === 'string' && !isMissingResult(fallbackValue)) {
      return fallbackValue;
    }

    const rawDefault = getRawTranslation(DEFAULT_LOCALE, key);
    if (rawDefault !== undefined) {
      return interpolate(rawDefault, params);
    }
  }

  // 4. Fall back to defaultValue if provided, otherwise the raw key
  if (params && typeof params.defaultValue === 'string') {
    return params.defaultValue;
  }

  return key;
}

/** Whether the given key resolves to a real translation in `locale`. */
export function hasTranslation(
  locale: Locale,
  key: string,
  _params?: Record<string, unknown>,
): boolean {
  return getRawTranslation(locale, key) !== undefined;
}

export default i18n;
