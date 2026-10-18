/**
 * scripts/generate-contract-bindings.ts
 *
 * Generates the backend TypeScript types for the aid_escrow contract from the
 * checked-in contract interface artifact
 * (`app/onchain/contracts/aid_escrow/interface.xdr`).
 *
 * The WASM is intentionally *not* read here: the artifact is the shared source
 * of truth, so the backend toolchain needs neither Rust nor the Stellar CLI.
 *
 * Exit codes:
 *   0 — bindings written (or already up to date in `--check` mode)
 *   1 — bindings out of date, or the spec artifact is missing/invalid
 *
 * Usage:
 *   pnpm --filter backend run contract:generate
 *   pnpm --filter backend run contract:check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import * as prettier from 'prettier';

import {
  BINDINGS_PATH,
  SPEC_PATH,
  generateBindings,
  loadCommittedSpec,
} from './lib/contract-spec';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const checkMode = process.argv.slice(2).includes('--check');

const BANNER = `/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 *
 * Type definitions for the aid_escrow Soroban contract, generated from the
 * committed contract interface spec.
 *
 * Source: app/onchain/contracts/aid_escrow/interface.xdr
 * Regenerate: pnpm --filter backend run contract:generate
 */

`;

/**
 * The SDK emits a fixed `import { Address } from '@stellar/stellar-sdk'` header
 * that is unused for contracts whose address fields are typed as strings. Drop
 * imports whose bindings are not referenced anywhere in the body so the
 * generated file passes `no-unused-vars`.
 */
function stripUnusedImports(source: string): string {
  return source.replace(
    /^import\s+\{([^}]*)\}\s+from\s+'([^']+)';?\n/gm,
    (statement, names: string, moduleName: string) => {
      const body = source.replace(statement, '');
      const used = names
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0)
        .filter(name => new RegExp(`\\b${name}\\b`).test(body));

      return used.length > 0
        ? `import { ${used.join(', ')} } from '${moduleName}';\n`
        : '';
    },
  );
}

async function renderBindings(): Promise<string> {
  const spec = loadCommittedSpec();
  const withoutUnusedImports = stripUnusedImports(generateBindings(spec));
  const config = await prettier.resolveConfig(BINDINGS_PATH);

  return (
    BANNER +
    (await prettier.format(withoutUnusedImports, {
      ...config,
      filepath: BINDINGS_PATH,
      parser: 'typescript',
    }))
  );
}

async function main() {
  const rendered = await renderBindings();
  const existing = existsSync(BINDINGS_PATH)
    ? readFileSync(BINDINGS_PATH, 'utf-8')
    : null;

  if (existing === rendered) {
    console.log(
      '✅ Contract bindings are up to date — no drift detected ' +
        `(${relative(REPO_ROOT, BINDINGS_PATH)}).`,
    );
    return;
  }

  if (checkMode) {
    console.error(
      '❌ Contract bindings drift detected!\n\n' +
        `    ${relative(REPO_ROOT, BINDINGS_PATH)} does not match the types generated from\n` +
        `    ${relative(REPO_ROOT, SPEC_PATH)}.\n\n` +
        '    The contract interface artifact changed without the bindings being\n' +
        '    regenerated.\n\n' +
        '    To fix this, run:\n' +
        '      pnpm --filter backend run contract:generate\n' +
        '    then commit the updated bindings file.',
    );
    process.exit(1);
  }

  mkdirSync(dirname(BINDINGS_PATH), { recursive: true });
  writeFileSync(BINDINGS_PATH, rendered);
  console.log(
    `✅ Wrote contract bindings to ${relative(REPO_ROOT, BINDINGS_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error('❌ Failed to generate contract bindings.');
  console.error(err);
  process.exit(1);
});
