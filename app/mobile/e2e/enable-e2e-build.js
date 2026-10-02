#!/usr/bin/env node
/**
 * Flips the build-time E2E switch in `src/e2e/e2eBuildFlag.ts` (issue #932).
 *
 * Run this before building the APK the Maestro harness drives:
 *
 *   node e2e/enable-e2e-build.js           # enable the seams for an E2E build
 *   node e2e/enable-e2e-build.js --disable # restore the committed default
 *
 * Why a source constant instead of `EXPO_PUBLIC_E2E=1`: see the doc comment on
 * `src/e2e/e2eBuildFlag.ts`. The short version is that a release APK built via
 * Gradle has proven to drop the Babel `process.env` inlining, which silently
 * hides the E2E-only controls. Rewriting a literal removes that failure mode.
 *
 * Idempotent: re-running with a flag that is already in the requested state
 * is a no-op rather than an error, so the script is safe in CI retries and on
 * a developer machine that already enabled it.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FLAG_FILE = path.join(__dirname, '..', 'src', 'e2e', 'e2eBuildFlag.ts');
const ENABLED_LINE = 'export const E2E_BUILD_ENABLED: boolean = true;';
const DISABLED_LINE = 'export const E2E_BUILD_ENABLED: boolean = false;';

/**
 * Rewrites the E2E build flag.
 *
 * @param {boolean} [enabled]
 * @returns {{ changed: boolean, enabled: boolean, file: string }}
 */
function setE2EBuildEnabled(enabled = true) {
  const source = fs.readFileSync(FLAG_FILE, 'utf8');
  const from = enabled ? DISABLED_LINE : ENABLED_LINE;
  const to = enabled ? ENABLED_LINE : DISABLED_LINE;

  if (!source.includes(from)) {
    if (source.includes(to)) {
      return { changed: false, enabled, file: FLAG_FILE };
    }
    throw new Error(
      `Could not find the E2E build flag in ${FLAG_FILE}. Expected a line ` +
        `reading \`${from}\`.`,
    );
  }

  fs.writeFileSync(FLAG_FILE, source.replace(from, to));
  return { changed: true, enabled, file: FLAG_FILE };
}

if (require.main === module) {
  const result = setE2EBuildEnabled(!process.argv.includes('--disable'));
  console.log(
    `[e2e] E2E_BUILD_ENABLED=${result.enabled} ` +
      `(${result.changed ? 'flag rewritten' : 'already set'}) in ` +
      path.relative(process.cwd(), result.file),
  );
}

module.exports = { setE2EBuildEnabled, FLAG_FILE, ENABLED_LINE, DISABLED_LINE };
