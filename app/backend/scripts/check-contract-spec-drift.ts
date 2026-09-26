/**
 * scripts/check-contract-spec-drift.ts
 *
 * CI guard: compares the contract interface spec embedded in a freshly built
 * aid_escrow WASM against the committed artifact
 * (`app/onchain/contracts/aid_escrow/interface.xdr`).
 *
 * The WASM is read directly (its `contractspecv0` custom section) rather than
 * through the Stellar CLI, so this check needs no toolchain beyond the Rust
 * build Contract CI already performs.
 *
 * Exit codes:
 *   0 — committed spec matches the WASM (no drift)
 *   1 — drift detected, artifact missing, or WASM missing/unreadable
 *
 * Usage:
 *   pnpm --filter backend run contract:check:wasm
 *   ts-node scripts/check-contract-spec-drift.ts [path/to/aid_escrow.wasm]
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  ContractSpec,
  DEFAULT_WASM_PATH,
  SPEC_PATH,
  describeSpec,
  encodeSpec,
  loadCommittedSpec,
  parseSpec,
} from './lib/contract-spec';

const BACKEND_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(BACKEND_DIR, '..', '..');

function resolveWasmPath(): string {
  const fromArgs = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  return resolve(fromArgs ?? process.env.AID_ESCROW_WASM ?? DEFAULT_WASM_PATH);
}

function specFromWasm(wasmPath: string): ContractSpec {
  // The SDK exposes WASM parsing as `Spec.fromWasm`; `parseSpec` accepts the
  // same base64 stream, so re-encode via the SDK's own WASM reader.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Spec: SpecConstructor } =
    require('@stellar/stellar-sdk/contract') as {
      Spec: {
        new (entries: string): ContractSpec;
        fromWasm(wasm: Buffer): ContractSpec;
      };
    };
  return SpecConstructor.fromWasm(readFileSync(wasmPath));
}

function reportInterfaceChanges(
  committed: ContractSpec,
  fresh: ContractSpec,
): string {
  const committedEntries = describeSpec(committed);
  const freshEntries = describeSpec(fresh);

  const added: string[] = [];
  const removed: string[] = [];
  const retyped: string[] = [];

  for (const [name, kind] of freshEntries) {
    const previous = committedEntries.get(name);
    if (previous === undefined) {
      added.push(`${name} (${kind})`);
    } else if (previous !== kind) {
      retyped.push(`${name} (${previous} -> ${kind})`);
    }
  }

  for (const [name, kind] of committedEntries) {
    if (!freshEntries.has(name)) {
      removed.push(`${name} (${kind})`);
    }
  }

  const lines: string[] = [];
  if (added.length > 0) lines.push(`  added:   ${added.join(', ')}`);
  if (removed.length > 0) lines.push(`  removed: ${removed.join(', ')}`);
  if (retyped.length > 0) lines.push(`  changed: ${retyped.join(', ')}`);

  if (lines.length === 0) {
    lines.push(
      '  Exported names are unchanged; struct fields, enum cases, error ' +
        'codes, or function signatures changed.',
    );
  }

  return lines.join('\n');
}

function main(): void {
  const specRelative = relative(REPO_ROOT, SPEC_PATH);
  const wasmPath = resolveWasmPath();
  const wasmRelative = relative(REPO_ROOT, wasmPath);

  if (!existsSync(SPEC_PATH)) {
    console.error(
      `❌ Committed contract spec artifact not found: ${specRelative}\n` +
        '   Run `pnpm --filter backend run contract:export` and commit the result.',
    );
    process.exit(1);
  }

  if (!existsSync(wasmPath)) {
    console.error(
      `❌ Contract WASM not found: ${wasmRelative}\n` +
        '   Build it first:\n' +
        '     cd app/onchain && cargo build --release --target wasm32v1-none -p aid_escrow\n' +
        '   or point AID_ESCROW_WASM at an existing build.',
    );
    process.exit(1);
  }

  let freshSpec: ContractSpec;
  try {
    freshSpec = specFromWasm(wasmPath);
  } catch (err: unknown) {
    console.error(`❌ Could not read a contract spec from ${wasmRelative}.`);
    console.error(err);
    process.exit(1);
  }

  const committedSpec = loadCommittedSpec();

  if (
    encodeSpec(freshSpec.entries) === readFileSync(SPEC_PATH, 'utf-8').trim()
  ) {
    console.log(
      `✅ Contract spec artifact is up to date — no drift detected (${wasmRelative}).`,
    );
    return;
  }

  console.error(
    '❌ Contract spec drift detected!\n\n' +
      `    ${specRelative} does not match the spec embedded in\n` +
      `    ${wasmRelative}.\n\n` +
      '    The contract interface changed without the artifact being re-exported.\n\n' +
      '    To fix this, run:\n' +
      '      pnpm --filter backend run contract:export\n' +
      '      pnpm --filter backend run contract:generate\n' +
      '    then commit both the updated artifact and the regenerated bindings.\n\n' +
      '    Interface changes:\n' +
      reportInterfaceChanges(committedSpec, freshSpec) +
      '\n',
  );
  process.exit(1);
}

main();
