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
 *   npx ts-node generate-types.ts [--contract CONTRACT_NAME] [--output OUTPUT_PATH]
 *
 * Examples:
 *   npx ts-node generate-types.ts --contract aid_escrow
 *   npx ts-node generate-types.ts --contract aid_escrow --output ../backend/src/types/generated
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface ContractType {
  kind: "enum" | "struct";
  variants?: Array<{ name: string; value?: string }>;
  fields?: Array<{ name: string; type: string }>;
}

interface ContractSpec {
  schema_version: string;
  generated_at: string;
  contract: {
    name: string;
    version: string;
    types: Record<string, ContractType>;
    errors: Record<string, number>;
    events: Record<string, { fields: string[] }>;
  };
}

/**
 * Parse Rust contract source directly to extract types, errors, and events
 */
function parseRustContract(contractName: string, contractDir: string): ContractSpec["contract"] {
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

  const spec: ContractSpec["contract"] = {
    name: contractName,
    version,
    types: {},
    errors: {},
    events: {},
  };

  // Extract contracttype enums and structs
  const enumPattern =
    /#\[contracttype\]\s*#?\[derive\([^)]*\)\]\s*(?:#\[repr\([^)]*\))?\s*pub enum (\w+)\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(enumPattern)) {
    const enumName = match[1];
    const enumBody = match[2];

    const variants: Array<{ name: string; value?: string }> = [];
    const lines = enumBody.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//")) {
        if (trimmed.includes("=")) {
          const [varName, varValue] = trimmed.split("=").map((s) => s.trim().replace(/,/, ""));
          variants.push({ name: varName, value: varValue });
        } else {
          const varName = trimmed.replace(/,/, "");
          if (varName) {
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
    /#\[contracttype\]\s*#?\[derive\([^)]*\)\]\s*pub struct (\w+)\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(structPattern)) {
    const structName = match[1];
    const structBody = match[2];

    const fields: Array<{ name: string; type: string }> = [];
    const lines = structBody.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && trimmed.includes(":")) {
        const [fieldName, fieldType] = trimmed.split(":").map((s) => s.trim().replace(/,/, ""));
        if (fieldName && fieldType) {
          fields.push({ name: fieldName, type: fieldType });
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
  const errorPattern = /#\[contracterror\]\s*pub enum (\w+)\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(errorPattern)) {
    const errorBody = match[2];
    const lines = errorBody.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes("=") && !trimmed.startsWith("//")) {
        const [errorName, errorCode] = trimmed.split("=").map((s) => s.trim().replace(/,/, ""));
        spec.errors[errorName] = parseInt(errorCode, 10);
      }
    }
  }

  // Extract contractevent
  const eventPattern = /#\[contractevent\]\s*pub struct (\w+)\s*\{([^}]*)\}/g;

  for (const match of source.matchAll(eventPattern)) {
    const eventName = match[1];
    const eventBody = match[2];

    const fields: string[] = [];
    const lines = eventBody.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && !trimmed.includes(":")) {
        fields.push(trimmed.replace(/,/, ""));
      }
    }

    spec.events[eventName] = { fields };
  }

  return spec;
}

/**
 * Map Rust types to TypeScript types
 */
function mapRustTypeToTs(rustType: string): string {
  // Clean up type string
  let type = rustType.trim();

  // Basic mappings
  const mappings: Record<string, string> = {
    u32: "number",
    u64: "number | string", // Use string for large numbers
    i128: "string", // Always use string for 128-bit integers (stroops)
    i64: "string",
    bool: "boolean",
    "String": "string",
    "Address": "string",
    "Map<Symbol, String>": "Record<string, string>",
    "Vec<Address>": "string[]",
    "Option<Address>": "string | undefined",
  };

  // Check exact matches first
  if (mappings[type]) {
    return mappings[type];
  }

  // Handle generic types
  if (type.includes("Map<")) {
    return "Record<string, any>";
  }

  if (type.includes("Vec<")) {
    const innerType = type.match(/Vec<(.+)>/)?.[1] ?? "any";
    return `${mapRustTypeToTs(innerType)}[]`;
  }

  if (type.includes("Option<")) {
    const innerType = type.match(/Option<(.+)>/)?.[1] ?? "any";
    return `${mapRustTypeToTs(innerType)} | undefined`;
  }

  // Return as-is for struct references and unknown types
  return type;
}

/**
 * Generate TypeScript enum from contract enum type
 */
function generateEnum(name: string, type: ContractType): string {
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
function generateInterface(name: string, type: ContractType): string {
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
function generateErrorEnum(
  contractName: string,
  errors: Record<string, number>
): string {
  const name = `${contractName}Error`;
  let enumDef = `export enum ${name} {\n`;

  for (const [errorName, code] of Object.entries(errors)) {
    enumDef += `  ${errorName} = ${code},\n`;
  }

  enumDef += `}\n\n`;

  // Generate error message map
  enumDef += `export const ${name}Messages: Record<${name}, string> = {\n`;
  for (const [errorName, code] of Object.entries(errors)) {
    enumDef += `  [${name}.${errorName}]: "${errorName}",\n`;
  }
  enumDef += `};\n`;

  return enumDef;
}

/**
 * Generate event interfaces
 */
function generateEventTypes(
  contractName: string,
  events: Record<string, { fields: string[] }>
): string {
  let eventDefs = "";

  for (const [eventName, event] of Object.entries(events)) {
    eventDefs += `export interface ${eventName} {\n`;

    // Events typically have indexed and non-indexed fields
    // For now, we'll use generic field names
    for (let i = 0; i < event.fields.length; i++) {
      eventDefs += `  field${i}: any;\n`;
    }

    eventDefs += `}\n\n`;
  }

  return eventDefs;
}

/**
 * Generate complete TypeScript file
 */
function generateTypescriptFile(spec: ContractSpec): string {
  const { name, version, types, errors, events } = spec.contract;

  let output = "";

  // Header comment
  output += `/**\n`;
  output += ` * Auto-generated TypeScript types from Soroban contract spec\n`;
  output += ` *\n`;
  output += ` * Contract: ${name}\n`;
  output += ` * Version: ${version}\n`;
  output += ` * Generated: ${spec.generated_at}\n`;
  output += ` *\n`;
  output += ` * DO NOT EDIT: This file is auto-generated. Changes will be overwritten.\n`;
  output += ` * To regenerate, run: npm run generate:contract-types\n`;
  output += ` */\n\n`;

  // Generate types
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

  // Generate errors
  if (Object.keys(errors).length > 0) {
    output += `// ============================================================================\n`;
    output += `// Error Codes\n`;
    output += `// ============================================================================\n\n`;
    output += generateErrorEnum(name, errors);
  }

  // Generate events
  if (Object.keys(events).length > 0) {
    output += `// ============================================================================\n`;
    output += `// Events\n`;
    output += `// ============================================================================\n\n`;
    output += generateEventTypes(name, events);
  }

  // Export version constant
  output += `// ============================================================================\n`;
  output += `// Contract Metadata\n`;
  output += `// ============================================================================\n\n`;
  output += `export const CONTRACT_NAME = "${name}";\n`;
  output += `export const CONTRACT_VERSION = "${version}";\n`;

  return output;
}

/**
 * Find contract directory
 */
function findContractDir(contractName: string): string {
  const scriptDir = path.dirname(__filename);
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
async function main(): Promise<number> {
  const args = process.argv.slice(2);

  let contractName = "aid_escrow";
  let outputPath: string | undefined;

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

    const spec: ContractSpec = {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      contract: contractSpec,
    };

    // Generate TypeScript code
    const typescriptCode = generateTypescriptFile(spec);

    // Determine output path
    if (!outputPath) {
      const scriptDir = path.dirname(__filename);
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

main().then((code) => process.exit(code));
