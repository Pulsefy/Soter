#!/usr/bin/env node
/**
 * Generate TypeScript types from Soroban contract specifications.
 *
 * This script:
 * 1. Parses Rust contract source files to extract types, errors, and events
 * 2. Generates a machine-readable contract spec JSON
 * 3. Generates strongly-typed TypeScript interfaces from the spec
 *
 * Usage:
 *   node generate-types.mjs [--contract CONTRACT_NAME] [--output OUTPUT_PATH]
 *
 * Examples:
 *   node generate-types.mjs --contract aid_escrow
 *   node generate-types.mjs --contract aid_escrow --output ../backend/src/types/generated
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Map Rust types to TypeScript types
 */
function mapRustTypeToTs(rustType) {
  let type = rustType.trim();

  const mappings = {
    u32: "number",
    u64: "number | string",
    i128: "string",
    i64: "string",
    bool: "boolean",
    String: "string",
    Address: "string",
    Symbol: "string",
    "Map<Symbol, String>": "Record<string, string>",
    "Vec<Address>": "string[]",
    "Option<Address>": "string | undefined",
  };

  if (mappings[type]) {
    return mappings[type];
  }

  if (type.includes("Map<")) {
    return "Record<string, unknown>";
  }

  if (type.includes("Vec<")) {
    const match = type.match(/Vec<(.+)>/);
    const innerType = match ? match[1] : "any";
    return `${mapRustTypeToTs(innerType)}[]`;
  }

  if (type.includes("Option<")) {
    const match = type.match(/Option<(.+)>/);
    const innerType = match ? match[1] : "any";
    return `${mapRustTypeToTs(innerType)} | undefined`;
  }

  return type;
}

/**
 * Generate TypeScript enum from contract enum type
 */
function generateEnum(name, type) {
  if (!type.variants) {
    return "";
  }

  let enumDef = `export enum ${name} {\n`;

  for (const variant of type.variants) {
    if (variant.value !== undefined) {
      enumDef += `  ${variant.name} = ${variant.value},\n`;
    } else {
      enumDef += `  ${variant.name} = "${variant.name}",\n`;
    }
  }

  enumDef += `}\n`;
  return enumDef;
}

/**
 * Generate TypeScript interface from contract struct type
 */
function generateInterface(name, type) {
  if (!type.fields) {
    return "";
  }

  let ifaceDef = `export interface ${name} {\n`;

  for (const field of type.fields) {
    const tsType = mapRustTypeToTs(field.type);
    const optional = field.type.includes("Option") ? "?" : "";
    ifaceDef += `  ${field.name}${optional}: ${tsType};\n`;
  }

  ifaceDef += `}\n`;
  return ifaceDef;
}

/**
 * Generate error code enum
 */
function generateErrorEnum(contractName, errors) {
  const name = `${contractName}Error`;
  let enumDef = `export enum ${name} {\n`;

  for (const [errorName, code] of Object.entries(errors)) {
    enumDef += `  ${errorName} = ${code},\n`;
  }

  enumDef += `}\n\n`;

  enumDef += `export const ${name}Messages: Record<${name}, string> = {\n`;
  for (const [errorName] of Object.entries(errors)) {
    enumDef += `  [${name}.${errorName}]: "${errorName}",\n`;
  }
  enumDef += `};\n`;

  return enumDef;
}

/**
 * Generate event interfaces
 */
function generateEventTypes(contractName, events) {
  let eventDefs = "";

  for (const [eventName, event] of Object.entries(events)) {
    eventDefs += `export interface ${eventName} {\n`;

    if (event.fields && event.fields.length > 0) {
      for (const field of event.fields) {
        if (field.name && field.type) {
          const tsType = mapRustTypeToTs(field.type);
          eventDefs += `  ${field.name}: ${tsType};\n`;
        }
      }
    } else {
      eventDefs += `  // No fields\n`;
    }

    eventDefs += `}\n\n`;
  }

  return eventDefs;
}

/**
 * Generate complete TypeScript file
 */
function generateTypescriptFile(spec) {
  const { name, version, types, errors, events } = spec.contract;

  let output = "";

  output += `/**\n`;
  output += ` * Auto-generated TypeScript types from Soroban contract spec\n`;
  output += ` *\n`;
  output += ` * Contract: ${name}\n`;
  output += ` * Version: ${version}\n`;
  output += ` *\n`;
  output += ` * DO NOT EDIT: This file is auto-generated. Changes will be overwritten.\n`;
  output += ` * To regenerate, run: npm run generate:contract-types\n`;
  output += ` */\n\n`;

  output += `// ============================================================================\n`;
  output += `// Data Types\n`;
  output += `// ============================================================================\n\n`;

  for (const [typeName, typeSpec] of Object.entries(types)) {
    if (typeSpec.kind === "enum") {
      output += generateEnum(typeName, typeSpec);
    } else if (typeSpec.kind === "struct") {
      output += generateInterface(typeName, typeSpec);
    }
    output += "\n";
  }

  if (Object.keys(errors).length > 0) {
    output += `// ============================================================================\n`;
    output += `// Error Codes\n`;
    output += `// ============================================================================\n\n`;
    output += generateErrorEnum(name, errors);
  }

  if (Object.keys(events).length > 0) {
    output += `// ============================================================================\n`;
    output += `// Events\n`;
    output += `// ============================================================================\n\n`;
    output += generateEventTypes(name, events);
  }

  output += `// ============================================================================\n`;
  output += `// Contract Metadata\n`;
  output += `// ============================================================================\n\n`;
  output += `export const CONTRACT_NAME = "${name}";\n`;
  output += `export const CONTRACT_VERSION = "${version}";\n`;

  return output;
}

/**
 * Parse Rust contract source directly to extract types, errors, and events
 */
function parseRustContract(contractName, contractDir) {
  const libRs = path.join(contractDir, "src", "lib.rs");

  if (!fs.existsSync(libRs)) {
    throw new Error(`Contract source not found: ${libRs}`);
  }

  const source = fs.readFileSync(libRs, "utf-8");

  // Extract version from Cargo.toml
  const cargoToml = path.join(contractDir, "Cargo.toml");
  let version = "0.0.0";
  if (fs.existsSync(cargoToml)) {
    const cargoContent = fs.readFileSync(cargoToml, "utf-8");
    const versionMatch = cargoContent.match(/version\s*=\s*"([^"]+)"/);
    if (versionMatch) {
      version = versionMatch[1];
    }
  }

  const spec = {
    name: contractName,
    version,
    types: {},
    errors: {},
    events: {},
  };

  // Extract contracttype enums and structs
  // Match patterns like:
  // #[contracttype]
  // #[derive(...)]
  // #[repr(...)]?
  // pub enum/struct Name { ... }
  const enumPattern =
    /#\[contracttype\](?:\s*#\[[^\]]*\])*\s*pub enum (\w+)\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(enumPattern)) {
    const enumName = match[1];
    const enumBody = match[2];

    const variants = [];
    const lines = enumBody.split("\n");

    for (const line of lines) {
      let trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
        if (trimmed.includes("=")) {
          const parts = trimmed.split("=").map((s) => s.trim().replace(/,/, ""));
          if (parts.length >= 2) {
            variants.push({ name: parts[0], value: parts[1] });
          }
        } else {
          const varName = trimmed.replace(/,/, "");
          if (varName && varName !== "}" && varName !== "{") {
            variants.push({ name: varName });
          }
        }
      }
    }

    if (variants.length > 0) {
      spec.types[enumName] = {
        kind: "enum",
        variants,
      };
    }
  }

  // Extract contracttype structs
  const structPattern =
    /#\[contracttype\](?:\s*#\[[^\]]*\])*\s*pub struct (\w+)\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(structPattern)) {
    const structName = match[1];
    const structBody = match[2];

    const fields = [];
    const lines = structBody.split("\n");

    for (const line of lines) {
      let trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && trimmed.includes(":")) {
        // Remove leading "pub" keyword
        trimmed = trimmed.replace(/^pub\s+/, "");
        const parts = trimmed.split(":").map((s) => s.trim().replace(/,/, ""));
        if (parts.length >= 2) {
          fields.push({ name: parts[0], type: parts[1] });
        }
      }
    }

    if (fields.length > 0) {
      spec.types[structName] = {
        kind: "struct",
        fields,
      };
    }
  }

  // Extract contracterror
  const errorPattern = /#\[contracterror\][\s\S]*?pub enum (\w+)\s*\{([^}]+)\}/;

  const errorMatch = source.match(errorPattern);
  if (errorMatch) {
    const errorBody = errorMatch[2];
    const lines = errorBody.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes("=") && !trimmed.startsWith("//")) {
        const parts = trimmed.split("=").map((s) => s.trim().replace(/,/, ""));
        if (parts.length >= 2) {
          spec.errors[parts[0]] = parseInt(parts[1], 10);
        }
      }
    }
  }

  // Extract contractevent
  const eventPattern = /#\[contractevent\]\s*pub struct (\w+)\s*\{([^}]*)\}/g;

  for (const match of source.matchAll(eventPattern)) {
    const eventName = match[1];
    const eventBody = match[2];

    const fields = [];
    const lines = eventBody.split("\n");

    for (const line of lines) {
      let trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && trimmed.includes(":")) {
        // Remove leading "pub" keyword
        trimmed = trimmed.replace(/^pub\s+/, "");
        const parts = trimmed.split(":").map((s) => s.trim().replace(/,/, ""));
        if (parts.length >= 2) {
          fields.push({ name: parts[0], type: parts[1] });
        }
      }
    }

    spec.events[eventName] = { fields };
  }

  return spec;
}

/**
 * Find contract directory
 */
function findContractDir(contractName) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const scriptDir = __dirname;
  const onchainRoot = path.dirname(scriptDir);
  const contractDir = path.join(onchainRoot, "contracts", contractName);

  if (!fs.existsSync(contractDir)) {
    throw new Error(`Contract directory not found: ${contractDir}`);
  }

  return contractDir;
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);

  let contractName = "aid_escrow";
  let outputPath = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contract" && args[i + 1]) {
      contractName = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  try {
    // Parse contract source
    const contractDir = findContractDir(contractName);
    console.log(`🔍 Parsing contract from: ${contractDir}`);

    const contractSpec = parseRustContract(contractName, contractDir);

    const spec = {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      contract: contractSpec,
    };

    // Generate TypeScript code
    const typescriptCode = generateTypescriptFile(spec);

    // Determine output path
    if (!outputPath) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const scriptDir = __dirname;
      const onchainRoot = path.dirname(scriptDir);
      outputPath = path.join(onchainRoot, "types", `${contractName}.generated.ts`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output file
    fs.writeFileSync(outputPath, typescriptCode, "utf-8");

    console.log(`✅ TypeScript types generated: ${outputPath}`);
    console.log(
      `   Types: ${Object.keys(spec.contract.types).length}, Errors: ${Object.keys(spec.contract.errors).length}, Events: ${Object.keys(spec.contract.events).length}`
    );

    return 0;
  } catch (error) {
    console.error(`❌ Error generating types: ${error}`);
    return 1;
  }
}

process.exit(main());
