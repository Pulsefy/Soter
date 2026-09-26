import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';
import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';

export const locales = ['en', 'es', 'fr'] as const;
export type Locale = (typeof locales)[number];

const messages = {
  en,
  es,
  fr,
};

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;

  if (!locale || !locales.includes(locale as any)) notFound();

  return {
    locale,
    messages: messages[locale as Locale],

    // Log missing keys in development so translators can spot gaps quickly.
    // In production this is a no-op; the fallback string is still shown to users.
    onError(error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[i18n] missing translation key:', error.message);
      }
    },

    // Return a readable placeholder instead of throwing so the UI stays usable
    // when a key is absent (e.g. during active translation work).
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join('.');
    },
  };
});
