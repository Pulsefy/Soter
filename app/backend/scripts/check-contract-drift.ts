/**
 * scripts/check-contract-drift.ts
 *
 * CI guard: validates that:
 *   1. The committed artifact (aid-escrow.contract.json) lists exactly the same
 *      public function names as lib.rs.
 *   2. The committed TypeScript bindings (aid-escrow.bindings.ts) are up-to-date
 *      with the artifact — i.e. every function in the artifact has a matching
 *      entry in CONTRACT_FN.
 *
 * Exit codes:
 *   0 — no drift detected
 *   1 — drift detected OR artifacts missing
 *
 * Usage (invoked by the `contract:check` npm script):
 *   pnpm --filter backend run contract:check
 *
 * To fix drift:
 *   pnpm --filter backend run contract:export
 *   pnpm --filter backend run contract:generate
 *   git add src/onchain/contract-interface/
 */

import { readFileSync, existsSync } from 'node:fs';
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
const BINDINGS_PATH = join(
  __dirname,
  '..',
  'src',
  'onchain',
  'contract-interface',
  'aid-escrow.bindings.ts',
);

// ---------------------------------------------------------------------------
// Helpers
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

function extractContractFnKeys(bindingsSource: string): string[] {
  // Extract the values from CONTRACT_FN = { ... } as const
  const blockMatch = bindingsSource.match(
    /export const CONTRACT_FN\s*=\s*\{([^}]+)\}/s,
  );
  if (!blockMatch) return [];

  const valueRegex = /:\s*'(\w+)'/g;
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = valueRegex.exec(blockMatch[1])) !== null) {
    values.push(m[1]);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function checkArtifactVsSource(
  artifactFunctions: string[],
  sourceFunctions: string[],
): boolean {
  const sourceSet = new Set(sourceFunctions);
  const artifactSet = new Set(artifactFunctions);

  const missing = sourceFunctions.filter((fn) => !artifactSet.has(fn));
  const extra = artifactFunctions.filter((fn) => !sourceSet.has(fn));

  let ok = true;

  if (missing.length > 0) {
    console.error(
      `❌  Artifact drift: the following public functions exist in lib.rs but\n` +
        `    are MISSING from the artifact:\n` +
        missing.map((fn) => `      - ${fn}`).join('\n'),
    );
    ok = false;
  }

  if (extra.length > 0) {
    console.error(
      `❌  Artifact drift: the following functions are in the artifact but\n` +
        `    NO LONGER exist in lib.rs:\n` +
        extra.map((fn) => `      - ${fn}`).join('\n'),
    );
    ok = false;
  }

  return ok;
}

function checkBindingsVsArtifact(
  bindingsFunctions: string[],
  artifactFunctions: string[],
): boolean {
  const bindingsSet = new Set(bindingsFunctions);
  const artifactSet = new Set(artifactFunctions);

  const missing = artifactFunctions.filter((fn) => !bindingsSet.has(fn));
  const extra = bindingsFunctions.filter((fn) => !artifactSet.has(fn));

  let ok = true;

  if (missing.length > 0) {
    console.error(
      `❌  Bindings drift: the following functions are in the artifact but\n` +
        `    MISSING from CONTRACT_FN in the bindings file:\n` +
        missing.map((fn) => `      - ${fn}`).join('\n'),
    );
    ok = false;
  }

  if (extra.length > 0) {
    console.error(
      `❌  Bindings drift: the following functions are in CONTRACT_FN but\n` +
        `    NO LONGER in the artifact:\n` +
        extra.map((fn) => `      - ${fn}`).join('\n'),
    );
    ok = false;
  }

  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  // Verify all files exist
  for (const [label, path] of [
    ['lib.rs', LIB_RS_PATH],
    ['artifact', ARTIFACT_PATH],
    ['bindings', BINDINGS_PATH],
  ] as [string, string][]) {
    if (!existsSync(path)) {
      console.error(
        `❌  ${label} not found at ${path}\n` +
          `    Run: pnpm --filter backend run contract:export && contract:generate`,
      );
      process.exit(1);
    }
  }

  const source = readFileSync(LIB_RS_PATH, 'utf-8');
  const sourceFunctions = extractPublicFunctions(source);

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8')) as {
    functions: Record<string, unknown>;
  };
  const artifactFunctions = Object.keys(artifact.functions);

  const bindingsSource = readFileSync(BINDINGS_PATH, 'utf-8');
  const bindingsFunctions = extractContractFnKeys(bindingsSource);

  let allOk = true;

  // Check 1: artifact vs lib.rs
  const artifactOk = checkArtifactVsSource(artifactFunctions, sourceFunctions);
  if (!artifactOk) {
    allOk = false;
    console.error(
      `\n    To fix: update src/onchain/contract-interface/aid-escrow.contract.json\n` +
        `    then run: pnpm --filter backend run contract:export`,
    );
  }

  // Check 2: bindings vs artifact
  const bindingsOk = checkBindingsVsArtifact(bindingsFunctions, artifactFunctions);
  if (!bindingsOk) {
    allOk = false;
    console.error(
      `\n    To fix: pnpm --filter backend run contract:generate`,
    );
  }

  if (!allOk) {
    console.error(
      `\n❌  Contract interface drift detected. Run the commands above and commit the results.`,
    );
    process.exit(1);
  }

  console.log(
    `✅  Contract interface is up to date — no drift detected.\n` +
      `    ${sourceFunctions.length} functions in lib.rs / ${artifactFunctions.length} in artifact / ${bindingsFunctions.length} in bindings.`,
  );
}

main();
