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

  if (!locale || !(locales as readonly string[]).includes(locale)) notFound();

  return {
    locale,
    messages: messages[locale as Locale],
    getMessageFallback({ namespace, key, error }) {
      const path = [namespace, key].filter((part) => part != null).join('.');

      if (error.code === 'MISSING_MESSAGE') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[next-intl] Missing translation: ${path}`);
        }
        return path;
      }

      return 'Error: ' + path;
    },
    onError(error) {
      if (error.code === 'MISSING_MESSAGE') {
        // Missing keys are handled in getMessageFallback
        return;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.error(error);
      }
    }
  };
});
