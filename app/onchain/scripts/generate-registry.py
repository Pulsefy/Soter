#!/usr/bin/env python3
"""Generate a deterministic contract registry JSON for backend/frontend consumption.

Reads the existing deployment data from deployments/registry.json and contract
metadata from Cargo.toml files, then produces a clean, deterministic JSON
registry file containing contract IDs, network, version, and deployed timestamp.

This script is designed to run in CI or locally without any secrets — it only
reads existing files already present in the repository.

Usage:
    python scripts/generate-registry.py [--project-dir DIR] [--output PATH]

Output format (contract-registry.json):
{
    "schema_version": 2,
    "generated_at": "2026-07-24T...",
    "contracts": {
        "aid_escrow": {
            "version": "0.2.0",          // from Cargo.toml
            "networks": {
                "testnet": {
                    "contract_id": "C...",
                    "version": "0.1.0",    // deployed version
                    "deployed_at": "2026-06-03"
                }
            }
        }
    }
}

The ``contracts`` map is keyed by contract name (from Cargo.toml).  Each entry
always includes the *source* version from Cargo.toml so the registry reflects
the current workspace even when no deployment exists yet.  The ``networks``
sub-map is keyed by network name and populated from deployments/registry.json;
it only appears when an actual deployment record exists for that contract +
network pair.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def parse_cargo_toml_version(cargo_path: Path) -> tuple[str, str]:
    """Extract (package_name, version) from a Cargo.toml file.

    Uses simple regex parsing — no toml dependency required, so this works
    in CI with only the standard library.
    """
    text = cargo_path.read_text(encoding="utf-8")
    name_match = re.search(r'^name\s*=\s*"([^"]+)"', text, re.MULTILINE)
    version_match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not name_match or not version_match:
        raise ValueError(f"Cannot parse name/version from {cargo_path}")
    return name_match.group(1), version_match.group(1)


def discover_contracts(contracts_dir: Path) -> dict[str, str]:
    """Walk the contracts/ directory and return {name: version} for each
    contract found (by reading each Cargo.toml).
    """
    result: dict[str, str] = {}
    if not contracts_dir.is_dir():
        return result
    for entry in contracts_dir.iterdir():
        if entry.is_dir():
            cargo = entry / "Cargo.toml"
            if cargo.is_file():
                name, version = parse_cargo_toml_version(cargo)
                result[name] = version
    return result


def load_deployment_registry(registry_path: Path) -> dict:
    """Load the existing deployment registry (deployments/registry.json).

    Returns the parsed dict, or an empty skeleton if the file does not exist.
    """
    if registry_path.is_file():
        return json.loads(registry_path.read_text(encoding="utf-8"))
    return {"schema_version": 1, "contract": "", "deployments": []}


def build_contract_registry(
    contracts: dict[str, str],
    deployment_registry: dict,
) -> dict:
    """Build the consumer-friendly registry structure.

    Parameters
    ----------
    contracts : {name: source_version}
        Discovered from Cargo.toml files.
    deployment_registry : dict
        The full deployments/registry.json data.

    Returns
    -------
    dict  — the contract-registry payload ready to serialise.
    """
    contracts_map: dict[str, dict] = {}

    # Ensure every discovered contract appears in the output, even if
    # there is no deployment record yet.
    for name, source_version in contracts.items():
        contracts_map[name] = {
            "version": source_version,
            "networks": {},
        }

    # Populate networks from deployment records.  Each deployment entry
    # maps to (contract_name, network) inside the ``networks`` sub-map.
    deployments = deployment_registry.get("deployments", [])

    # The deployment registry has a top-level "contract" field that names
    # the primary contract for the file, but we also handle cases where
    # the contract_name in each entry may differ (future multi-contract
    # registries).
    for dep in deployments:
        contract_name = dep.get("contract_name") or deployment_registry.get("contract", "")
        network = dep.get("network", "")
        if not contract_name or not network:
            continue

        # If the contract wasn't discovered from Cargo.toml (e.g. removed
        # from the workspace but still in the deployment history), we still
        # include it so the registry covers *all* deployed contracts.
        if contract_name not in contracts_map:
            contracts_map[contract_name] = {
                "version": dep.get("version", "unknown"),
                "networks": {},
            }

        contracts_map[contract_name]["networks"][network] = {
            "contract_id": dep["contract_id"],
            "wasm_hash": dep["wasm_hash"],
            "version": dep["version"],
            "deployed_at": dep["deployed_at"],
        }

    # Sort contracts and networks for deterministic output
    sorted_contracts: dict[str, dict] = {}
    for name in sorted(contracts_map.keys()):
        entry = contracts_map[name]
        sorted_networks: dict[str, dict] = {}
        for net in sorted(entry["networks"].keys()):
            sorted_networks[net] = entry["networks"][net]
        sorted_contracts[name] = {
            "version": entry["version"],
            "networks": sorted_networks,
        }

    return {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "contracts": sorted_contracts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a deterministic contract registry JSON for backend/frontend consumption",
    )
    parser.add_argument(
        "--project-dir",
        default=str(Path(__file__).resolve().parent.parent),
        help="Root directory of the onchain project (default: auto-detected from script location)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path for the generated registry JSON (default: <project-dir>/deployments/contract-registry.json)",
    )
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    output_path = Path(args.output) if args.output else project_dir / "deployments" / "contract-registry.json"

    # 1. Discover contracts from Cargo.toml files
    contracts_dir = project_dir / "contracts"
    contracts = discover_contracts(contracts_dir)
    if not contracts:
        print(f"⚠️  No contracts discovered in {contracts_dir}")

    # 2. Load existing deployment registry
    registry_path = project_dir / "deployments" / "registry.json"
    deployment_registry = load_deployment_registry(registry_path)

    # 3. Build consumer-friendly registry
    contract_registry = build_contract_registry(contracts, deployment_registry)

    # 4. Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(contract_registry, indent=2) + "\n",
        encoding="utf-8",
    )

    contract_count = len(contract_registry["contracts"])
    network_count = sum(
        len(entry["networks"]) for entry in contract_registry["contracts"].values()
    )
    print(f"✅ Contract registry generated: {output_path}")
    print(f"   {contract_count} contract(s), {network_count} network deployment(s)")
    print(f"   Schema version: {contract_registry['schema_version']}")
    for name, entry in contract_registry["contracts"].items():
        nets = ", ".join(sorted(entry["networks"].keys())) if entry["networks"] else "(no deployments yet)"
        print(f"   • {name} v{entry['version']} → {nets}")


if __name__ == "__main__":
    main()
