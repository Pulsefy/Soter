#!/usr/bin/env python3
"""
Export Soroban contract specification to a machine-readable format.

This script generates a JSON spec file from a compiled Soroban contract WASM.
The spec includes contract metadata, data types, error codes, and event structures
that can be used for TypeScript type generation.

Usage:
    python3 export-spec.py [--contract CONTRACT_NAME] [--output OUTPUT_PATH]

Examples:
    python3 export-spec.py --contract aid_escrow
    python3 export-spec.py --contract aid_escrow --output specs/aid_escrow.spec.json
"""

import json
import subprocess
import sys
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import re


def get_project_root() -> Path:
    """Get the onchain directory root (where this script is located)."""
    return Path(__file__).parent.parent


def get_contract_dir(contract_name: str) -> Path:
    """Get the contract directory by name."""
    root = get_project_root()
    contract_dir = root / "contracts" / contract_name
    if not contract_dir.exists():
        raise FileNotFoundError(f"Contract directory not found: {contract_dir}")
    return contract_dir


def get_built_wasm_path(contract_name: str) -> Path:
    """Get the path to the built WASM file."""
    root = get_project_root()
    wasm_path = root / "target" / "wasm32-unknown-unknown" / "release" / f"{contract_name}.wasm"
    if not wasm_path.exists():
        raise FileNotFoundError(f"Built WASM not found: {wasm_path}. Run 'cargo build --release' first.")
    return wasm_path


def get_contract_version(contract_name: str) -> str:
    """Extract version from contract Cargo.toml."""
    contract_dir = get_contract_dir(contract_name)
    cargo_toml = contract_dir / "Cargo.toml"
    
    with open(cargo_toml, "r") as f:
        content = f.read()
        # Extract version field from [package] section
        match = re.search(r'version\s*=\s*"([^"]+)"', content)
        if match:
            return match.group(1)
    
    raise ValueError(f"Could not extract version from {cargo_toml}")


def run_soroban_command(wasm_path: Path, output_format: str = "json") -> Dict[str, Any]:
    """Run soroban contract spec command to extract contract metadata."""
    try:
        result = subprocess.run(
            ["soroban", "contract", "spec", str(wasm_path)],
            capture_output=True,
            text=True,
            check=True,
        )
        
        # Parse the output - soroban spec returns XDR that needs to be decoded
        # For now, we'll return a structured format that can be built from the Rust code
        return {"raw_xdr": result.stdout.strip()}
    except subprocess.CalledProcessError as e:
        print(f"Error running soroban contract spec: {e.stderr}", file=sys.stderr)
        raise
    except FileNotFoundError:
        print("soroban CLI not found. Install it with: cargo install soroban-cli", file=sys.stderr)
        raise


def parse_rust_contract(contract_name: str) -> Dict[str, Any]:
    """
    Parse Rust contract source directly to extract types, errors, and events.
    This is a fallback when soroban spec is not available, and provides more
    structured information for TypeScript generation.
    """
    contract_dir = get_contract_dir(contract_name)
    lib_rs = contract_dir / "src" / "lib.rs"
    
    if not lib_rs.exists():
        raise FileNotFoundError(f"Contract source not found: {lib_rs}")
    
    with open(lib_rs, "r") as f:
        source = f.read()
    
    spec = {
        "name": contract_name,
        "version": get_contract_version(contract_name),
        "types": {},
        "errors": {},
        "events": {},
    }
    
    # Extract contracttype enums and structs
    enum_pattern = r'#\[contracttype\]\s*#?\[derive\([^)]*\)\]\s*(?:#\[repr\([^)]*\))?\s*pub enum (\w+)\s*\{([^}]+)\}'
    for match in re.finditer(enum_pattern, source):
        enum_name = match.group(1)
        enum_body = match.group(2)
        
        variants = []
        for line in enum_body.split('\n'):
            line = line.strip()
            if '=' in line:
                # Variant with explicit value
                parts = line.rstrip(',').split('=')
                var_name = parts[0].strip()
                var_value = parts[1].strip()
                variants.append({"name": var_name, "value": var_value})
            elif line and not line.startswith('//'):
                # Variant without explicit value
                var_name = line.rstrip(',')
                if var_name:
                    variants.append({"name": var_name})
        
        if variants:
            spec["types"][enum_name] = {
                "kind": "enum",
                "variants": variants,
            }
    
    # Extract contracttype structs
    struct_pattern = r'#\[contracttype\]\s*#?\[derive\([^)]*\)\]\s*pub struct (\w+)\s*\{([^}]+)\}'
    for match in re.finditer(struct_pattern, source):
        struct_name = match.group(1)
        struct_body = match.group(2)
        
        fields = []
        for line in struct_body.split('\n'):
            line = line.strip()
            if ':' in line and not line.startswith('//'):
                # Extract field name and type
                parts = line.rstrip(',').split(':')
                if len(parts) == 2:
                    field_name = parts[0].strip()
                    field_type = parts[1].strip()
                    fields.append({"name": field_name, "type": field_type})
        
        if fields:
            spec["types"][struct_name] = {
                "kind": "struct",
                "fields": fields,
            }
    
    # Extract contracterror
    error_pattern = r'#\[contracterror\]\s*pub enum (\w+)\s*\{([^}]+)\}'
    for match in re.finditer(error_pattern, source):
        error_enum = match.group(1)
        error_body = match.group(2)
        
        errors = {}
        for line in error_body.split('\n'):
            line = line.strip()
            if '=' in line:
                parts = line.rstrip(',').split('=')
                error_name = parts[0].strip()
                error_code = parts[1].strip()
                errors[error_name] = int(error_code)
        
        spec["errors"] = errors
    
    # Extract contractevent
    event_pattern = r'#\[contractevent\]\s*pub struct (\w+)\s*\{([^}]*)\}'
    for match in re.finditer(event_pattern, source):
        event_name = match.group(1)
        event_body = match.group(2)
        
        fields = []
        for line in event_body.split('\n'):
            line = line.strip()
            if ',' in line and not line.startswith('//'):
                # Event fields are simpler - just type names or expressions
                fields.append(line.rstrip(','))
        
        spec["events"][event_name] = {"fields": fields}
    
    return spec


def create_spec_file(contract_name: str, spec: Dict[str, Any]) -> str:
    """Create a JSON spec file content."""
    from datetime import datetime
    
    spec_with_metadata = {
        "schema_version": "1.0",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "contract": spec,
    }
    
    return json.dumps(spec_with_metadata, indent=2)


def ensure_specs_dir() -> Path:
    """Ensure specs directory exists."""
    root = get_project_root()
    specs_dir = root / "specs"
    specs_dir.mkdir(exist_ok=True)
    return specs_dir


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Export Soroban contract specification for TypeScript code generation"
    )
    parser.add_argument(
        "--contract",
        default="aid_escrow",
        help="Contract name (default: aid_escrow)",
    )
    parser.add_argument(
        "--output",
        help="Output file path (default: specs/{contract_name}.spec.json)",
    )
    parser.add_argument(
        "--wasm-only",
        action="store_true",
        help="Only use soroban spec extraction (requires soroban CLI)",
    )
    
    args = parser.parse_args()
    
    try:
        # Parse contract source for structured types
        spec = parse_rust_contract(args.contract)
        
        # Generate spec file content
        spec_content = create_spec_file(args.contract, spec)
        
        # Determine output path
        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            specs_dir = ensure_specs_dir()
            output_path = specs_dir / f"{args.contract}.spec.json"
        
        # Write spec file
        with open(output_path, "w") as f:
            f.write(spec_content)
        
        print(f"✅ Contract spec exported to: {output_path}")
        print(f"   Types: {len(spec['types'])}")
        print(f"   Errors: {len(spec['errors'])}")
        print(f"   Events: {len(spec['events'])}")
        
        return 0
    
    except Exception as e:
        print(f"❌ Error exporting spec: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
