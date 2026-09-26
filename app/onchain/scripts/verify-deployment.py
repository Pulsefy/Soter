#!/usr/bin/env python3
"""Verify a deployed artifact matches its machine-readable registry entry."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def wasm_hash_hex(wasm_path: Path) -> str:
    return hashlib.sha256(wasm_path.read_bytes()).hexdigest()


def find_deployment(registry: dict, *, contract_id: str, network: str, version: str) -> dict:
    for deployment in registry.get("deployments", []):
        if (
            deployment.get("contract_id") == contract_id
            and deployment.get("network") == network
            and deployment.get("version") == version
        ):
            return deployment
    raise ValueError(
        f"No registry deployment found for {contract_id} on {network} (version {version})"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify a deployed Wasm artifact matches deployments/registry.json"
    )
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--contract-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--network", default="testnet")
    parser.add_argument("--wasm", required=True)
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    wasm_path = Path(args.wasm)
    if not wasm_path.is_absolute():
        wasm_path = project_dir / wasm_path
    registry_path = project_dir / "deployments" / "registry.json"

    try:
        artifact_hash = wasm_hash_hex(wasm_path)
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        deployment = find_deployment(
            registry,
            contract_id=args.contract_id,
            network=args.network,
            version=args.version,
        )
        registry_hash = deployment.get("wasm_hash")
        if artifact_hash != registry_hash:
            raise ValueError(
                f"WASM checksum mismatch: artifact={artifact_hash} registry={registry_hash}"
            )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"verified": False, "error": str(exc)}))
        return 1

    print(
        json.dumps(
            {
                "verified": True,
                "contract_id": args.contract_id,
                "network": args.network,
                "version": args.version,
                "wasm_hash": artifact_hash,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())