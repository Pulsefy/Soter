#!/usr/bin/env node
/**
 * Mobile i18n CI check.
 *
 * Verifies:
 *  1. Every locale catalog (`src/i18n/messages/*.json`) defines exactly the
 *     same key set — a key present in `en` but missing from `es`/`fr` (or
 *     vice-versa) is reported as *untranslated*.
 *  2. `en` still uses `${placeholder}` interpolation tokens anywhere a
 *     translated value does (`{x}`), so translators keep valid replacements.
 *  3. Screen files contain no obvious *hardcoded* user-facing strings
 *     (capitalised prose) outside of generated/test/data files.
 *
 * Exits non-zero when any rule fails. Run from the repo root.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, '..', 'src', 'i18n', 'messages');
const SCREENS_DIR = join(__dirname, '..', 'src', 'screens');
const COMPONENTS_DIR = join(__dirname, '..', 'src', 'components');

const LOCALE_FILES = ['en.json', 'es.json', 'fr.json'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flatten(d, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const f of flatten(v, `${prefix}${k}.`)) out.add(f);
    } else {
      out.add(`${prefix}${k}`);
    }
  }
  return out;
}

function interpolations(value) {
  const matches = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m;
  while ((m = re.exec(value)) !== null) matches.push(m[1]);
  return matches;
}

// Heuristic: a quoted JSX text / string literal that looks like prose.
// Excludes obvious non-user-facing strings (style keys, native props, etc.).
const NON_STRING_TOKENS = new Set([
  'roles', 'style', 'styles', 'data-testid', 'testID', 'testId', 'accessibilityRole',
  'accessibilityHint', 'accessibilityLabel', 'accessibilityValue', 'accessibilityState',
  'accessibilityLiveRegion', 'accessibilityElementsHidden', 'importantForAccessibility',
  'keyboardType', 'placeholder', 'autoCapitalize', 'numberOfLines', 'hitSlop',
  'backgroundColor', 'color', 'textTransform', 'fontWeight', 'letterSpacing',
]);

function looksLikeProse(text) {
  if (!text || !/^[A-Za-z]/.test(text)) return false;
  // Contains a space or sentence punctuation => prose candidate.
  if (/[a-z][A-Z]/.test(text)) return true; // camelCase
  if (text.split(' ').length >= 2) return true;
  if (/[.,!?]/.test(text)) return true;
  return false;
}

function scanFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const findings = [];
  const lines = src.split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    // Skip comments, import specifiers, style objects.
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    if (/^\s*import\s/.test(line)) return;

    // Match JSX text: `>Some prose<` and string literals `"Some prose"`.
    const jsxMatches = [...line.matchAll(/>([^<>{}]{3,})</g)];
    const strMatches = [...line.matchAll(/"([^"]{3,})"/g)];

    for (const m of jsxMatches) {
      const text = m[1].trim();
      if (looksLikeProse(text)) {
        findings.push(`${filePath}:${lineNo}: hardcoded JSX text "${text}"`);
      }
    }

    for (const m of strMatches) {
      const pre = line.slice(0, m.index);
      const token = (pre.match(/([a-zA-Z][a-zA-Z0-9-]*)\s*=$/) || [])[1];
      if (token && NON_STRING_TOKENS.has(token)) continue;
      const text = m[1];
      // Skip URLs, hex colors, tests, and single-word style values.
      if (/^(https?:|#)/.test(text)) continue;
      if (!looksLikeProse(text)) continue;
      findings.push(`${filePath}:${lineNo}: hardcoded prose "${text}"`);
    }
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const catalogs = {};
let enKeys = new Set();
for (const file of LOCALE_FILES) {
  const raw = readFileSync(join(MESSAGES_DIR, file), 'utf8');
  const json = JSON.parse(raw);
  const keys = flatten(json);
  catalogs[file] = json;
  if (file === 'en.json') enKeys = keys;
}

const errors = [];

// 1. Untranslated / missing keys per locale.
for (const file of LOCALE_FILES) {
  if (file === 'en.json') continue;
  const keys = flatten(catalogs[file]);
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));
  for (const k of missing) {
    errors.push(`${file} is missing key (untranslated): ${k}`);
  }
  for (const k of extra) {
    errors.push(`${file} has a key not present in en.json: ${k}`);
  }
}

// 2. Interpolation-token drift between locales.
const interpErrors = [];
for (const file of LOCALE_FILES) {
  if (file === 'en.json') continue;
  for (const k of enKeys) {
    const enVal = pick(catalogs['en.json'], k);
    const val = pick(catalogs[file], k);
    if (enVal == null || val == null) continue;
    const enTokens = new Set(interpolations(String(enVal)));
    const tokens = new Set(interpolations(String(val)));
    if (String(enVal).includes('{') && !setsEqual(enTokens, tokens)) {
      interpErrors.push(`${file} — key "${k}" has mismatched placeholders`);
    }
  }
}
errors.push(...interpErrors);

// 3. Hardcoded prose in screens/components.
const scanned = [];
for (const dir of [SCREENS_DIR, COMPONENTS_DIR]) {
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    continue;
  }
  for (const f of files.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
    scanned.push(join(dir, f));
    errors.push(...scanFile(join(dir, f)));
  }
}

function pick(obj, dotted) {
  return dotted.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Mobile i18n check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nHint: keep en.json as the source of truth; add es/fr mirrors in the same commit.');
  process.exit(1);
}

console.log(`Mobile i18n check passed: ${LOCALE_FILES.length} locale catalogs in sync, ${scanned.length} files scanned for hardcoded strings.`);