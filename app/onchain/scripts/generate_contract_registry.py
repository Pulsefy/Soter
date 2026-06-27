#!/usr/bin/env python3
"""Generate a machine-readable contract registry artifact from deployments/registry.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_registry(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    return {
        "schema_version": 1,
        "contract": "aid_escrow",
        "deployments": [],
    }


def build_contract_registry(registry_path: Path) -> dict[str, Any]:
    registry = load_registry(registry_path)
    deployments = registry.get("deployments", [])

    contracts: list[dict[str, Any]] = []
    for deployment in deployments:
        contract_id = deployment.get("contract_id")
        if not contract_id:
            continue

        contracts.append(
            {
                "name": deployment.get("contract_name") or registry.get("contract") or "unknown",
                "network": deployment.get("network"),
                "version": deployment.get("version"),
                "contract_id": contract_id,
                "deployed_at": deployment.get("deployed_at"),
                "wasm_hash": deployment.get("wasm_hash"),
                "record": deployment.get("record"),
                "version_tag": deployment.get("version_tag"),
            }
        )

    contracts.sort(
        key=lambda item: (
            str(item.get("name", "")),
            str(item.get("network", "")),
            str(item.get("version", "")),
            str(item.get("contract_id", "")),
        )
    )

    return {
        "schema_version": registry.get("schema_version", 1),
        "contracts": contracts,
    }


def write_contract_registry(artifact: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a machine-readable contract registry artifact")
    parser.add_argument(
        "--registry-json",
        default="deployments/registry.json",
        help="Path to the source registry JSON file",
    )
    parser.add_argument(
        "--output",
        default="deployments/contract-registry.json",
        help="Path to write the generated contract registry JSON",
    )
    args = parser.parse_args()

    registry_path = Path(args.registry_json)
    output_path = Path(args.output)

    if not registry_path.is_absolute():
        project_dir = Path(__file__).resolve().parents[1]
        registry_path = project_dir / registry_path
        output_path = project_dir / output_path

    artifact = build_contract_registry(registry_path)
    write_contract_registry(artifact, output_path)
    print(f"WROTE={output_path}")


if __name__ == "__main__":
    main()
