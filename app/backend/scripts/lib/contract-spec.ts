/**
 * scripts/lib/contract-spec.ts
 *
 * Shared helpers for working with the checked-in aid_escrow contract interface
 * artifact (`app/onchain/contracts/aid_escrow/interface.xdr`).
 *
 * The artifact is a base64-encoded stream of `SCSpecEntry` XDR values, exactly
 * the data `stellar contract info interface --output xdr-base64` emits. It is
 * the only contract-to-backend contract: the backend never reads WASM.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BindingGenerator, xdr } from '@stellar/stellar-sdk';
import type { Spec } from '@stellar/stellar-sdk/lib/contract';

export const CONTRACT_NAME = 'aid-escrow';

const BACKEND_DIR = resolve(__dirname, '..', '..');
const ONCHAIN_DIR = resolve(BACKEND_DIR, '..', 'onchain');

export const SPEC_PATH = resolve(
  ONCHAIN_DIR,
  'contracts',
  'aid_escrow',
  'interface.xdr',
);

export const BINDINGS_PATH = resolve(
  BACKEND_DIR,
  'src',
  'onchain',
  'generated',
  `${CONTRACT_NAME}.contract.ts`,
);

export const DEFAULT_WASM_PATH = resolve(
  ONCHAIN_DIR,
  'target',
  'wasm32v1-none',
  'release',
  'aid_escrow.wasm',
);

export type ContractSpec = Spec;

/**
 * `Spec` is published as the `@stellar/stellar-sdk/contract` subpath export,
 * which TypeScript cannot resolve under this project's legacy `node` module
 * resolution. The types come from the package-internal declaration file while
 * the runtime honours the public subpath.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Spec: SpecConstructor } = require('@stellar/stellar-sdk/contract') as {
  Spec: new (entries: string) => ContractSpec;
};

/**
 * Parses a base64 `SCSpecEntry` XDR stream into an SDK `Spec`.
 */
export function parseSpec(encoded: string): ContractSpec {
  const spec = new SpecConstructor(encoded.trim());
  if (spec.entries.length === 0) {
    throw new Error('The contract spec contains no entries.');
  }
  return spec;
}

/**
 * Reads the committed spec artifact and parses it into an SDK `Spec`.
 */
export function loadCommittedSpec(specPath: string = SPEC_PATH): ContractSpec {
  if (!existsSync(specPath)) {
    throw new Error(
      `Contract spec artifact not found: ${specPath}\n` +
        'Run `pnpm --filter backend run contract:export` and commit the result.',
    );
  }

  const encoded = readFileSync(specPath, 'utf-8').trim();
  if (encoded.length === 0) {
    throw new Error(
      `Contract spec artifact is empty: ${specPath}\n` +
        'Run `pnpm --filter backend run contract:export` and commit the result.',
    );
  }

  try {
    return parseSpec(encoded);
  } catch (err: unknown) {
    throw new Error(
      `Contract spec artifact is not a valid SCSpecEntry XDR stream: ${specPath}\n` +
        `  ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Builds the typed TypeScript definitions for the contract interface.
 */
export function generateBindings(spec: ContractSpec): string {
  return BindingGenerator.fromSpec(spec).generate({
    contractName: CONTRACT_NAME,
  }).types;
}

/**
 * Re-encodes spec entries into the base64 `SCSpecEntry` XDR stream format.
 * Round-trips byte-for-byte with `stellar contract info interface
 * --output xdr-base64`, so it is safe to compare against the committed
 * artifact.
 */
export function encodeSpec(entries: xdr.ScSpecEntry[]): string {
  return Buffer.concat(
    entries.map(entry => Buffer.from(entry.toXDR('raw'))),
  ).toString('base64');
}

/**
 * Builds a lookup of exported names (functions, structs, enums, error enums)
 * so drift between two specs can be reported as a readable diff instead of a
 * wall of base64.
 */
export function describeSpec(spec: ContractSpec): Map<string, string> {
  const described = new Map<string, string>();

  for (const func of spec.funcs()) {
    described.set(`fn ${func.name().toString()}`, 'function');
  }

  for (const entry of spec.entries) {
    switch (entry.switch().value) {
      case xdr.ScSpecEntryKind.scSpecEntryUdtStructV0().value: {
        described.set(`type ${entry.udtStructV0().name()}`, 'struct');
        break;
      }
      case xdr.ScSpecEntryKind.scSpecEntryUdtEnumV0().value: {
        described.set(`type ${entry.udtEnumV0().name()}`, 'enum');
        break;
      }
      case xdr.ScSpecEntryKind.scSpecEntryUdtErrorEnumV0().value: {
        described.set(`type ${entry.udtErrorEnumV0().name()}`, 'error enum');
        break;
      }
      case xdr.ScSpecEntryKind.scSpecEntryUdtUnionV0().value: {
        described.set(`type ${entry.udtUnionV0().name()}`, 'union');
        break;
      }
      default:
        break;
    }
  }

  return described;
}
