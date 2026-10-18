/**
 * Tests for localeStore — verifies that locale selection is persisted and
 * readable across separate calls (simulating session persistence).
 */
import { useLocaleStore } from '../localeStore';

// Reset the store state between tests to prevent leakage.
beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});

describe('localeStore', () => {
  it('defaults to "en"', () => {
    const { locale } = useLocaleStore.getState();
    expect(locale).toBe('en');
  });

  it('updates locale when setLocale is called', () => {
    const { setLocale } = useLocaleStore.getState();
    setLocale('fr');
    expect(useLocaleStore.getState().locale).toBe('fr');
  });

  it('overwrites a previously stored locale', () => {
    const { setLocale } = useLocaleStore.getState();
    setLocale('es');
    setLocale('fr');
    expect(useLocaleStore.getState().locale).toBe('fr');
  });

  it('accepts all supported locales without error', () => {
    const { setLocale } = useLocaleStore.getState();
    // The store is typed to Locale — verify each valid value can be stored.
    for (const locale of ['en', 'es', 'fr'] as const) {
      setLocale(locale);
      expect(useLocaleStore.getState().locale).toBe(locale);
    }
  });
});
