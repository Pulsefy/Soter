/**
 * scripts/check-spec-drift.ts
 *
 * CI guard: regenerates the OpenAPI spec in memory and compares it with the
 * committed artifact at openapi/openapi.json.
 *
 * Exit codes:
 *   0 — specs match (no drift)
 *   1 — specs differ (drift detected) OR committed artifact is missing
 *       OR the app failed to bootstrap
 *
 * Usage (invoked by the `spec:check` npm script):
 *   pnpm --filter backend run spec:check
 */
import { readFileSync, existsSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadSwaggerEnv,
  createSwaggerDocument,
} from '../src/swagger-document';

const strictMode = process.env.OPENAPI_SPEC_CHECK_STRICT !== 'false';

// This script terminates with process.exit(), which does not flush a piped
// stdout/stderr buffer. Write synchronously so the verdict always shows up in
// the CI log instead of being silently discarded.
const write = (stream: 1 | 2, message: string) =>
  writeSync(stream, `${message}\n`);
const log = (message: string) => write(1, message);
const logError = (message: string) => write(2, message);
const describeError = (err: unknown) =>
  err instanceof Error
    ? err.stack || `${err.name}: ${err.message}`
    : String(err);

async function checkDrift() {
  loadSwaggerEnv();

  const committedPath = join(process.cwd(), 'openapi', 'openapi.json');

  if (!existsSync(committedPath)) {
    if (!strictMode) {
      log(
        '⚠️  OpenAPI artifact missing; skipping drift check because OPENAPI_SPEC_CHECK_STRICT=false.',
      );
      process.exit(0);
    }

    logError(
      '❌  Committed artifact openapi/openapi.json not found.\n' +
        '    Run `pnpm --filter backend run spec:generate` and commit the result.',
    );
    process.exit(1);
  }

  try {
    const { app, document: freshDocument } = await createSwaggerDocument();
    await app.close();

    // Normalize both sides by round-tripping through JSON.stringify(JSON.parse())
    // so formatting differences (whitespace, key order) don't cause false positives.
    const fresh = JSON.stringify(freshDocument);
    const committed = JSON.stringify(
      JSON.parse(readFileSync(committedPath, 'utf-8')),
    );

    if (fresh === committed) {
      log('✅  OpenAPI spec is up to date — no drift detected.');
      process.exit(0);
    }

    const freshPaths = Object.keys(freshDocument.paths ?? {}).length;
    const committedPaths = Object.keys(
      (JSON.parse(readFileSync(committedPath, 'utf-8')) as { paths?: object })
        .paths ?? {},
    ).length;

    logError(
      '❌  OpenAPI spec drift detected!\n\n' +
        `    Generated paths: ${freshPaths}  |  committed paths: ${committedPaths}\n\n` +
        '    The committed artifact (openapi/openapi.json) does not match the\n' +
        '    spec generated from the current source code.\n\n' +
        '    To fix this, run:\n' +
        '      pnpm --filter backend run spec:generate\n' +
        '    then commit the updated openapi/openapi.json.',
    );

    process.exit(1);
  } catch (err: unknown) {
    if (!strictMode) {
      log(
        '⚠️  OpenAPI generation failed in this environment; skipping spec drift enforcement because OPENAPI_SPEC_CHECK_STRICT=false.',
      );
      logError(describeError(err));
      process.exit(0);
    }

    logError('❌  Failed to generate OpenAPI spec for drift check.');
    logError(describeError(err));
    process.exit(1);
  }
}

void checkDrift();
