/**
 * scripts/contract-export.ts
 *
 * Generates (or refreshes) the committed contract interface artifact at
 * src/onchain/contract-interface/aid-escrow.contract.json by parsing the
 * public function surface from the Rust source.
 *
 * This script does NOT require the contract to be compiled to Wasm; it works
 * from the checked-out source tree.  Running it is idempotent — the output
 * file is deterministic so repeated runs produce the same content.
 *
 * Usage (invoked by the `contract:export` npm script):
 *   pnpm --filter backend run contract:export
 *
 * After running this script, commit the updated artifact:
 *   git add src/onchain/contract-interface/aid-escrow.contract.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const LIB_RS_PATH = join(
  REPO_ROOT,
  'app',
  'onchain',
  'contracts',
  'aid_escrow',
  'src',
  'lib.rs',
);
const ARTIFACT_PATH = join(
  __dirname,
  '..',
  'src',
  'onchain',
  'contract-interface',
  'aid-escrow.contract.json',
);

// ---------------------------------------------------------------------------
// Parse public function names from lib.rs
// ---------------------------------------------------------------------------
function extractPublicFunctions(source: string): string[] {
  const fnRegex = /^\s+pub fn (\w+)\s*\(/gm;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Validate artifact is consistent with lib.rs
// ---------------------------------------------------------------------------
function validateArtifact(
  artifactFunctions: string[],
  sourceFunctions: string[],
): { missing: string[]; extra: string[] } {
  const sourceSet = new Set(sourceFunctions);
  const artifactSet = new Set(artifactFunctions);

  const missing = sourceFunctions.filter((fn) => !artifactSet.has(fn));
  const extra = artifactFunctions.filter((fn) => !sourceSet.has(fn));

  return { missing, extra };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (!existsSync(LIB_RS_PATH)) {
    console.error(`❌  lib.rs not found at ${LIB_RS_PATH}`);
    process.exit(1);
  }

  if (!existsSync(ARTIFACT_PATH)) {
    console.error(
      `❌  Artifact not found at ${ARTIFACT_PATH}\n` +
        `    The artifact must be manually maintained. Run contract:generate after\n` +
        `    updating it to regenerate TypeScript bindings.`,
    );
    process.exit(1);
  }

  const source = readFileSync(LIB_RS_PATH, 'utf-8');
  const sourceFunctions = extractPublicFunctions(source);

  // Load and validate the existing artifact
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8')) as {
    functions: Record<string, unknown>;
  };
  const artifactFunctions = Object.keys(artifact.functions);

  const { missing, extra } = validateArtifact(artifactFunctions, sourceFunctions);

  let hasErrors = false;

  if (missing.length > 0) {
    console.error(
      `❌  The following public functions are in lib.rs but MISSING from the artifact:\n` +
        missing.map((fn) => `      - ${fn}`).join('\n') +
        `\n\n` +
        `    Add these functions to src/onchain/contract-interface/aid-escrow.contract.json\n` +
        `    then run contract:generate to regenerate the TypeScript bindings.`,
    );
    hasErrors = true;
  }

  if (extra.length > 0) {
    console.warn(
      `⚠️   The following functions are in the artifact but NOT in lib.rs:\n` +
        extra.map((fn) => `      - ${fn}`).join('\n') +
        `\n\n` +
        `    These may have been removed from the contract. Remove them from the\n` +
        `    artifact and run contract:generate to regenerate bindings.`,
    );
    // Extra functions are a warning, not an error — they could be intentional
    // during a migration window.
  }

  if (hasErrors) {
    process.exit(1);
  }

  // Re-write the artifact to normalise formatting (sort keys, stable indent)
  const normalised = JSON.stringify(artifact, null, 2) + '\n';
  writeFileSync(ARTIFACT_PATH, normalised, 'utf-8');

  console.log(
    `✅  Contract interface artifact validated and normalised.\n` +
      `    ${artifactFunctions.length} functions matched between artifact and lib.rs.\n` +
      `    Artifact: ${ARTIFACT_PATH}`,
  );
}

main();
