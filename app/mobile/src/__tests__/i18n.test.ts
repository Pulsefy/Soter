/**
 * Mobile i18n guarantees (part of the #933 localization CI check).
 *
 * Verifies that every locale catalog exposes exactly the same keys as the
 * English source of truth (so no string falls back to an English UI), and
 * that interpolation placeholders stay in sync between locales so runtime
 * substitution always resolves.
 *
 * The static hardcoded-string scan lives at `scripts/check-i18n.mjs` (run in
 * CI); this test covers the data integrity half of the same rule.
 */

const en = require('../i18n/messages/en.json');
const es = require('../i18n/messages/es.json');
const fr = require('../i18n/messages/fr.json');

const CATALOGS: Record<string, Record<string, unknown>> = { en, es, fr };

function flatten(d: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    } else {
      out[`${prefix}${k}`] = String(v);
    }
  }
  return out;
}

function interpolations(value: string): string[] {
  const tokens: string[] = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) tokens.push(m[1]);
  return tokens;
}

describe('i18n catalog integrity', () => {
  const enFlat = flatten(CATALOGS.en);
  const enKeys = Object.keys(enFlat);
  expect(enKeys.length).toBeGreaterThan(50);

  for (const [name, catalog] of Object.entries(CATALOGS)) {
    if (name === 'en') continue;
    const flat = flatten(catalog as Record<string, unknown>);
    const keys = Object.keys(flat);

    it(`${name} exposes every key defined in en`, () => {
      const missing = enKeys.filter((k) => !(k in flat));
      expect(missing).toEqual([]);
    });

    it(`${name} has no keys that en does not define`, () => {
      const extra = keys.filter((k) => !(k in enFlat));
      expect(extra).toEqual([]);
    });

    it(`${name} keeps interpolation placeholders in sync with en`, () => {
      const mismatched = enKeys.filter((k) => {
        const enValue = enFlat[k];
        if (!enValue.includes('{')) return false;
        const a = interpolations(enValue).sort();
        const b = interpolations(flat[k] ?? '').sort();
        return JSON.stringify(a) !== JSON.stringify(b);
      });
      expect(mismatched).toEqual([]);
    });
  }
});

jest.mock('../services/crashReporting', () => ({
  captureError: jest.fn(),
}));

describe('runtime i18n fallback and missing key reporting (#1168)', () => {
  const {
    t,
    setLocale,
    getLocale,
    hasTranslation,
    messages,
    resetReportedMissingKeys,
    DEFAULT_LOCALE,
  } = require('../i18n');
  const { captureError } = require('../services/crashReporting');

  beforeEach(() => {
    jest.clearAllMocks();
    resetReportedMissingKeys();
    setLocale('en');
  });

  afterEach(() => {
    setLocale('en');
  });

  it('translates normally in the active locale when the key exists', () => {
    setLocale('es');
    expect(getLocale()).toBe('es');
    expect(t('common.soter')).toBe(messages.es.common.soter);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('detects presence and absence of keys accurately with hasTranslation', () => {
    expect(hasTranslation('en', 'common.soter')).toBe(true);
    expect(hasTranslation('es', 'common.soter')).toBe(true);
    expect(hasTranslation('es', 'nonexistent.key.test')).toBe(false);
  });

  it('falls back to the default locale (en) string rather than the raw key when deliberately removed', () => {
    const originalEsCancel = messages.es.common.cancel;
    expect(originalEsCancel).toBeDefined();

    // Acceptance criterion 3: Verified with a deliberately removed key
    delete messages.es.common.cancel;

    try {
      setLocale('es');
      expect(hasTranslation('es', 'common.cancel')).toBe(false);

      const translated = t('common.cancel');

      // Acceptance criterion 1: Falls back to default locale's string ("Cancel"), not raw key "common.cancel"
      expect(translated).toBe(messages.en.common.cancel);
      expect(translated).toBe('Cancel');

      // Acceptance criterion 2: Reported to crash/error reporting
      expect(captureError).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'MissingTranslationError',
          message: expect.stringContaining('common.cancel'),
        }),
        expect.objectContaining({
          key: 'common.cancel',
          locale: 'es',
          fallbackLocale: DEFAULT_LOCALE,
        }),
      );
    } finally {
      // Restore key
      messages.es.common.cancel = originalEsCancel;
    }
  });

  it('interpolates placeholders when falling back to default locale with a deliberately removed key', () => {
    const originalEsActiveWallet = messages.es.home.activeWallet;
    expect(originalEsActiveWallet).toBeDefined();

    // Deliberately remove key with {walletName} placeholder
    delete messages.es.home.activeWallet;

    try {
      setLocale('es');
      const translated = t('home.activeWallet', { walletName: 'Lobstr' });

      // Fallback replaces placeholders using English template ("Active wallet: {walletName}")
      expect(translated).toBe('Active wallet: Lobstr');

      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          key: 'home.activeWallet',
          locale: 'es',
          fallbackLocale: 'en',
        }),
      );
    } finally {
      messages.es.home.activeWallet = originalEsActiveWallet;
    }
  });

  it('deduplicates reporting for the same missing key to prevent event flooding', () => {
    setLocale('es');
    t('missing.key.flood');
    t('missing.key.flood');
    t('missing.key.flood');

    const matchingCalls = (captureError as jest.Mock).mock.calls.filter(
      ([, ctx]) => ctx?.key === 'missing.key.flood',
    );
    expect(matchingCalls).toHaveLength(1);
  });

  it('falls back to raw key (or defaultValue) and reports error when key is absent in all locales', () => {
    setLocale('es');
    const result = t('untranslated.absent.feature');

    // Key absent everywhere falls back to raw key
    expect(result).toBe('untranslated.absent.feature');
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        key: 'untranslated.absent.feature',
        locale: 'es',
        fallbackLocale: 'en',
      }),
    );

    const withDefault = t('untranslated.absent.withDefault', { defaultValue: 'Default Text' });
    expect(withDefault).toBe('Default Text');
  });
});

