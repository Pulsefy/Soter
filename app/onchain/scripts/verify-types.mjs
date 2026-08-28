#!/usr/bin/env node
/**
 * Verify that committed contract types match the generated ones.
 *
 * This script is run in CI to ensure that contract type definitions haven't
 * drifted from the actual Rust contract definitions. It regenerates types
 * and compares them against the committed versions, failing if they differ.
 *
 * Usage:
 *   node verify-types.mjs [--contract CONTRACT_NAME]
 *
 * Exit codes:
 *   0 - Types are in sync
 *   1 - Types are out of sync or generation failed
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const onchainRoot = path.dirname(__dirname);

/**
 * Generate types to a temporary location
 */
function generateTypesToTemp(contractName) {
  const tempDir = path.join(onchainRoot, ".types-temp");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempOutput = path.join(tempDir, `${contractName}.generated.ts`);

  try {
    execSync(`node ${path.join(__dirname, "generate-types.mjs")} --contract ${contractName} --output ${tempOutput}`, {
      stdio: "inherit",
    });
    return tempOutput;
  } catch (error) {
    throw new Error(`Failed to generate types: ${error.message}`);
  }
}

/**
 * Compare two files and return true if they're identical
 */
function filesAreIdentical(file1, file2) {
  if (!fs.existsSync(file1)) {
    console.error(`❌ File not found: ${file1}`);
    return false;
  }

  if (!fs.existsSync(file2)) {
    console.error(`❌ File not found: ${file2}`);
    return false;
  }

  const content1 = fs.readFileSync(file1, "utf-8");
  const content2 = fs.readFileSync(file2, "utf-8");

  return content1 === content2;
}

/**
 * Main verification
 */
function main() {
  const args = process.argv.slice(2);
  let contractName = "aid_escrow";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contract" && args[i + 1]) {
      contractName = args[++i];
    }
  }

  try {
    console.log(`🔍 Verifying contract types for: ${contractName}`);

    // Generate fresh types
    console.log("📝 Generating types...");
    const tempOutput = generateTypesToTemp(contractName);

    // Location of committed types (in onchain/types/)
    const committedTypes = path.join(onchainRoot, "types", `${contractName}.generated.ts`);

    // Compare
    console.log(`📊 Comparing against committed types...`);
    console.log(`   Generated: ${tempOutput}`);
    console.log(`   Committed: ${committedTypes}`);

    if (filesAreIdentical(tempOutput, committedTypes)) {
      console.log(`✅ Contract types are in sync!`);

      // Cleanup temp
      try {
        fs.rmSync(path.join(onchainRoot, ".types-temp"), { recursive: true });
      } catch {}

      return 0;
    } else {
      console.error(`❌ Contract types are OUT OF SYNC!`);
      console.error(``);
      console.error(`The committed contract types don't match the generated ones.`);
      console.error(`This likely means the Rust contract changed but types weren't regenerated.`);
      console.error(``);
      console.error(`To fix this, run:`);
      console.error(`  node app/onchain/scripts/generate-types.mjs --contract aid_escrow`);
      console.error(``);
      console.error(`Then commit the updated file at app/onchain/types/aid_escrow.generated.ts.`);

      return 1;
    }
  } catch (error) {
    console.error(`❌ Verification failed: ${error.message}`);
    return 1;
  }
}

process.exit(main());
