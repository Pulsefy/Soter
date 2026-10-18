/**
 * scripts/contract-generate.ts
 *
 * Regenerates the TypeScript bindings file
 * src/onchain/contract-interface/aid-escrow.bindings.ts from the committed
 * artifact at src/onchain/contract-interface/aid-escrow.contract.json.
 *
 * Usage (invoked by the `contract:generate` npm script):
 *   pnpm --filter backend run contract:generate
 *
 * After running this script, commit the updated bindings:
 *   git add src/onchain/contract-interface/aid-escrow.bindings.ts
 *
 * The check-contract-drift.ts script (run by `contract:check`) verifies that
 * the committed bindings match what this script would generate.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ARTIFACT_PATH = join(
  __dirname,
  '..',
  'src',
  'onchain',
  'contract-interface',
  'aid-escrow.contract.json',
);
const BINDINGS_PATH = join(
  __dirname,
  '..',
  'src',
  'onchain',
  'contract-interface',
  'aid-escrow.bindings.ts',
);

// ---------------------------------------------------------------------------
// Types mirroring the artifact schema
// ---------------------------------------------------------------------------
interface ArtifactField {
  name: string;
  type: string;
}

interface ArtifactFunction {
  doc?: string;
  args: ArtifactField[];
  returns: string;
  auth: string[];
}

interface ArtifactType {
  kind: 'struct' | 'enum' | 'error';
  variants?: string[];
  fields?: Record<string, string>;
}

interface ContractArtifact {
  name: string;
  version: string;
  types: Record<string, ArtifactType>;
  functions: Record<string, ArtifactFunction>;
}

// ---------------------------------------------------------------------------
// Code-generation helpers
// ---------------------------------------------------------------------------

function sorobanTypeToTs(sorobanType: string): string {
  const map: Record<string, string> = {
    'Address': 'string',
    'String': 'string',
    'Symbol': 'string',
    'Bytes': 'string',
    'bool': 'boolean',
    'u32': 'number',
    'i32': 'number',
    'u64': 'bigint',
    'i64': 'bigint',
    'u128': 'bigint',
    'i128': 'bigint',
    '()': 'void',
  };

  if (map[sorobanType]) return map[sorobanType];

  // Vec<T>
  const vecMatch = sorobanType.match(/^Vec<(.+)>$/);
  if (vecMatch) return `${sorobanTypeToTs(vecMatch[1])}[]`;

  // Option<T>
  const optMatch = sorobanType.match(/^Option<(.+)>$/);
  if (optMatch) return `${sorobanTypeToTs(optMatch[1])} | null`;

  // Result<T, E>
  const resultMatch = sorobanType.match(/^Result<(.+),\s*.+>$/);
  if (resultMatch) return sorobanTypeToTs(resultMatch[1]);

  // Map<K, V>
  const mapMatch = sorobanType.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch)
    return `Record<${sorobanTypeToTs(mapMatch[1])}, ${sorobanTypeToTs(mapMatch[2])}>`;

  // Tuple (A, B)
  const tupleMatch = sorobanType.match(/^\((.+)\)$/);
  if (tupleMatch) {
    const parts = tupleMatch[1].split(',').map((p) => sorobanTypeToTs(p.trim()));
    return `[${parts.join(', ')}]`;
  }

  // Custom type — return as-is (will be a named interface or enum)
  return `Contract${sorobanType}`;
}

function generateEnumBlock(name: string, type: ArtifactType): string {
  const variants = type.variants ?? [];
  const isError = type.kind === 'error';
  const tsName = isError ? 'ContractError' : name;

  const lines: string[] = [];
  lines.push(`export enum ${tsName} {`);
  for (const v of variants) {
    lines.push(`  ${v} = '${v}',`);
  }
  lines.push('}');
  return lines.join('\n');
}

function generateStructBlock(name: string, type: ArtifactType): string {
  const fields = type.fields ?? {};
  const lines: string[] = [];
  lines.push(`export interface Contract${name} {`);
  for (const [fieldName, fieldType] of Object.entries(fields)) {
    lines.push(`  ${fieldName}: ${sorobanTypeToTs(fieldType)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function generateFunctionConstants(
  functions: Record<string, ArtifactFunction>,
): string {
  const entries = Object.keys(functions)
    .map((fn) => `  ${fn.toUpperCase()}: '${fn}',`)
    .join('\n');

  return (
    `export const CONTRACT_FN = {\n${entries}\n} as const;\n\n` +
    `export type ContractFunctionName = (typeof CONTRACT_FN)[keyof typeof CONTRACT_FN];`
  );
}

function generatePendingWithdrawalInterface(): string {
  return [
    '/**',
    ' * A proposed but not-yet-executed surplus withdrawal.',
    ' *',
    ' * Created by `propose_surplus_withdrawal`; removed by either',
    ' * `cancel_surplus_withdrawal` or `execute_surplus_withdrawal`.',
    ' */',
    'export interface PendingWithdrawal {',
    '  /** Destination address for the transfer. */',
    '  to: string;',
    '  /** Token contract address. */',
    '  token: string;',
    '  /** Amount in smallest token units. */',
    '  amount: bigint;',
    '  /**',
    '   * Earliest ledger timestamp at which `execute_surplus_withdrawal` may be',
    '   * called. Equal to proposal time + SURPLUS_WITHDRAWAL_DELAY_SECS (86400).',
    '   */',
    '  executable_at: bigint;',
    '}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
function generateBindings(artifact: ContractArtifact): string {
  const sections: string[] = [];

  // Header
  sections.push(
    [
      '/**',
      ' * aid-escrow.bindings.ts',
      ' *',
      ' * AUTO-GENERATED — do NOT edit by hand.',
      ' * Regenerate with: pnpm --filter backend run contract:generate',
      ' *',
      ' * TypeScript bindings derived from the AidEscrow contract interface artifact',
      ' * at src/onchain/contract-interface/aid-escrow.contract.json.',
      ' *',
      ' * These types mirror the on-chain contract\'s public surface so that the',
      ' * TypeScript layer stays in sync with the Soroban contract.',
      ' */',
    ].join('\n'),
  );

  // Enums and error enum
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('// Enum types');
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('');

  for (const [typeName, typeDef] of Object.entries(artifact.types)) {
    if (typeDef.kind === 'enum' || typeDef.kind === 'error') {
      sections.push(generateEnumBlock(typeName, typeDef));
      sections.push('');
    }
  }

  // Structs
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('// Struct types');
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('');

  for (const [typeName, typeDef] of Object.entries(artifact.types)) {
    if (typeDef.kind === 'struct') {
      if (typeName === 'PendingWithdrawal') {
        sections.push(generatePendingWithdrawalInterface());
      } else {
        sections.push(generateStructBlock(typeName, typeDef));
      }
      sections.push('');
    }
  }

  // Constants
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('// Constants mirrored from the contract');
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('');
  sections.push('/** Minimum delay in seconds between proposing and executing a surplus withdrawal. */');
  sections.push('export const SURPLUS_WITHDRAWAL_DELAY_SECS = 86_400n;');
  sections.push('');
  sections.push('/** Maximum batch claim size. */');
  sections.push('export const MAX_BATCH_CLAIM_SIZE = 25;');
  sections.push('');
  sections.push('/** Maximum batch revoke/refund size. */');
  sections.push('export const MAX_BATCH_REVOKE_REFUND_SIZE = 25;');
  sections.push('');
  sections.push('/** Maximum page size for list queries. */');
  sections.push('export const MAX_PAGE_SIZE = 50;');
  sections.push('');
  sections.push('/** Default maximum number of distributor addresses. */');
  sections.push('export const DEFAULT_MAX_DISTRIBUTORS = 100;');
  sections.push('');
  sections.push('/** Maximum distributor page size. */');
  sections.push('export const MAX_DISTRIBUTOR_PAGE_SIZE = 50;');
  sections.push('');

  // Function name constants
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('// Function name constants (avoids magic strings when building invocations)');
  sections.push('// ---------------------------------------------------------------------------');
  sections.push('');
  sections.push(generateFunctionConstants(artifact.functions));
  sections.push('');

  return sections.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (!existsSync(ARTIFACT_PATH)) {
    console.error(
      `❌  Artifact not found at ${ARTIFACT_PATH}\n` +
        `    Run contract:export first to validate/refresh the artifact.`,
    );
    process.exit(1);
  }

  const artifact = JSON.parse(
    readFileSync(ARTIFACT_PATH, 'utf-8'),
  ) as ContractArtifact;

  const generated = generateBindings(artifact);
  writeFileSync(BINDINGS_PATH, generated, 'utf-8');

  const fnCount = Object.keys(artifact.functions).length;
  const typeCount = Object.keys(artifact.types).length;

  console.log(
    `✅  TypeScript bindings regenerated.\n` +
      `    ${fnCount} functions, ${typeCount} types.\n` +
      `    Output: ${BINDINGS_PATH}`,
  );
}

main();
