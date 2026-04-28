import { useLocale } from 'next-intl';

/**
 * Custom hook for locale-aware formatting
 */
export function useFormatter() {
  const locale = useLocale();

  const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, options).format(dateObj);
  };

  const formatTime = (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(dateObj);
  };

  const formatDateTime = (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(dateObj);
  };

  const formatNumber = (num: number, options?: Intl.NumberFormatOptions) => {
    return new Intl.NumberFormat(locale, options).format(num);
  };

  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const formatRelativeTime = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    if (diffInSeconds < 60) return 'dates.justNow';
    if (diffInSeconds < 3600) return `dates.minutesAgo`;
    if (diffInSeconds < 86400) return `dates.hoursAgo`;
    if (diffInSeconds < 604800) return `dates.daysAgo`;
    if (diffInSeconds < 2592000) return `dates.weeksAgo`;
    if (diffInSeconds < 31536000) return `dates.monthsAgo`;
    return `dates.yearsAgo`;
  };

  const formatRelativeTimeValue = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    if (diffInSeconds < 60) return { key: 'dates.justNow', count: 0 };
    if (diffInSeconds < 3600) return { key: 'dates.minutesAgo', count: Math.floor(diffInSeconds / 60) };
    if (diffInSeconds < 86400) return { key: 'dates.hoursAgo', count: Math.floor(diffInSeconds / 3600) };
    if (diffInSeconds < 604800) return { key: 'dates.daysAgo', count: Math.floor(diffInSeconds / 86400) };
    if (diffInSeconds < 2592000) return { key: 'dates.weeksAgo', count: Math.floor(diffInSeconds / 604800) };
    if (diffInSeconds < 31536000) return { key: 'dates.monthsAgo', count: Math.floor(diffInSeconds / 2592000) };
    return { key: 'dates.yearsAgo', count: Math.floor(diffInSeconds / 31536000) };
  };

  return {
    formatDate,
    formatTime,
    formatDateTime,
    formatNumber,
    formatCurrency,
    formatRelativeTime,
    formatRelativeTimeValue,
  };
}