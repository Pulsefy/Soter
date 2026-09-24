/**
 * Locale-aware formatting for dates, numbers, and currency.
 *
 * Uses the ECMAScript `Intl` API bound to the active app locale (see
 * `getLocale`), so all values render the way a field worker in that locale
 * expects, regardless of device-level regional settings.
 */

import { getLocale, type Locale } from './index';

/** Normalize to a BCP-47 tag (e.g. "es" -> "es", "pt-BR" stays). */
function intlTag(locale: Locale): string {
  return locale;
}

/**
 * Format a timestamp (seconds or milliseconds) as a localized date.
 * By default treats the input as a Unix epoch in *seconds* (Stellar ledger
 * convention). Pass `ms: true` for JavaScript millisecond timestamps.
 */
export function formatDate(
  input: number | string | Date,
  opts: { ms?: boolean } = {},
): string {
  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'string') {
    date = new Date(input);
  } else {
    const ms = opts.ms ? input : input * 1000;
    date = new Date(ms);
  }
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(intlTag(getLocale()), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Relative human date ("today" / "yesterday" / "3 days ago"). */
export function formatRelativeDate(
  input: number,
  ms: boolean,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const epochMs = ms ? input : input * 1000;
  const now = Date.now();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfInput = new Date(epochMs);
  startOfInput.setHours(0, 0, 0, 0);

  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfInput.getTime()) / 86_400_000,
  );
  if (dayDiff === 0) return t('dates.today');
  if (dayDiff === 1) return t('dates.yesterday');
  if (dayDiff === -1) return t('dates.tomorrow');
  if (dayDiff > 0) return t('dates.daysAgo', { count: dayDiff });
  return formatDate(input, { ms });
}

/** Format a number with thousands separators in the active locale. */
export function formatNumber(input: number): string {
  return new Intl.NumberFormat(intlTag(getLocale())).format(input);
}

/** Format a price with the given currency code (e.g. "USD"). */
export function formatCurrency(
  input: number,
  currency: string = 'USD',
): string {
  try {
    return new Intl.NumberFormat(intlTag(getLocale()), {
      style: 'currency',
      currency,
    }).format(input);
  } catch {
    return `${formatNumber(input)} ${currency}`;
  }
}
