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
