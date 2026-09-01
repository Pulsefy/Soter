#!/usr/bin/env python3
"""Tests for the generate-registry.py script.

Validates that the generated contract-registry.json:
  - Includes all contracts and their IDs
  - Contains the required fields (contract_id, network, version, deployed_at)
  - Is deterministic (same input → same output)
  - Can be generated without secrets (CI-safe)
  - Has correct schema_version
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
GENERATE_SCRIPT = PROJECT_DIR / "scripts" / "generate-registry.py"


def _run_generate(output_path: Path, project_dir: Path = PROJECT_DIR) -> dict:
    """Run generate-registry.py and return the parsed output JSON."""
    result = subprocess.run(
        [
            sys.executable,
            str(GENERATE_SCRIPT),
            "--project-dir",
            str(project_dir),
            "--output",
            str(output_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    registry = json.loads(output_path.read_text(encoding="utf-8"))
    return registry


def test_registry_includes_all_contracts():
    """AC: Output includes all contracts and their IDs."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    registry = _run_generate(tmp_path)

    # Must have the 'contracts' top-level key
    assert "contracts" in registry, "Missing 'contracts' key in registry"

    # aid_escrow must be present (it's the only contract in the workspace)
    assert "aid_escrow" in registry["contracts"], "aid_escrow contract missing from registry"

    # Check that the testnet deployment entry exists with a contract_id
    aid_escrow = registry["contracts"]["aid_escrow"]
    assert "networks" in aid_escrow, "Missing 'networks' in aid_escrow entry"
    assert "testnet" in aid_escrow["networks"], "testnet deployment missing from aid_escrow"

    testnet_entry = aid_escrow["networks"]["testnet"]
    assert "contract_id" in testnet_entry, "Missing contract_id in testnet entry"
    assert testnet_entry["contract_id"], "contract_id is empty in testnet entry"

    tmp_path.unlink()


def test_registry_required_fields():
    """AC: Output contains contract IDs, network, version, and deployed timestamp."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    registry = _run_generate(tmp_path)
    testnet = registry["contracts"]["aid_escrow"]["networks"]["testnet"]

    # Required fields per the issue
    required_fields = ["contract_id", "wasm_hash", "version", "deployed_at"]
    for field in required_fields:
        assert field in testnet, f"Missing required field: {field}"
        assert testnet[field], f"Required field {field} is empty"

    assert len(testnet["wasm_hash"]) == 64

    # network is implicit in the key structure (testnet), but we verify
    # it's present in the networks map
    assert "testnet" in registry["contracts"]["aid_escrow"]["networks"]

    # Source version from Cargo.toml must be present
    assert "version" in registry["contracts"]["aid_escrow"]
    assert registry["contracts"]["aid_escrow"]["version"] == "0.2.0"

    tmp_path.unlink()


def test_registry_deterministic():
    """AC: Can be generated deterministically — same inputs produce same contract data."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp1:
        tmp1_path = Path(tmp1.name)
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp2:
        tmp2_path = Path(tmp2.name)

    registry1 = _run_generate(tmp1_path)
    registry2 = _run_generate(tmp2_path)

    # The contract data (contracts map) must be identical across runs.
    # generated_at will differ, so we compare only the contracts section.
    assert registry1["contracts"] == registry2["contracts"], \
        "Registry contracts section is not deterministic"

    # Schema version must be the same
    assert registry1["schema_version"] == registry2["schema_version"]

    tmp1_path.unlink()
    tmp2_path.unlink()


def test_registry_ci_safe():
    """AC: Can be generated in CI or locally without secrets."""
    # The script should succeed without any environment variables or secrets.
    # We explicitly clear relevant env vars and verify it still works.
    env = dict(__import__("os").environ)
    # Remove any deployment-related env vars that shouldn't be needed
    for key in ["SECRET_KEY", "CONTRACT_ID", "DEPLOYER_SECRET_KEY", "NETWORK"]:
        env.pop(key, None)

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    result = subprocess.run(
        [
            sys.executable,
            str(GENERATE_SCRIPT),
            "--project-dir",
            str(PROJECT_DIR),
            "--output",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        env=env,
        check=True,
    )

    # Must succeed (exit code 0 already checked by check=True)
    registry = json.loads(tmp_path.read_text(encoding="utf-8"))
    assert "contracts" in registry
    assert "aid_escrow" in registry["contracts"]

    tmp_path.unlink()


def test_registry_schema_version():
    """Verify the schema_version is set to 2 (the new consumer-friendly format)."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    registry = _run_generate(tmp_path)
    assert registry["schema_version"] == 2, \
        f"Expected schema_version 2, got {registry['schema_version']}"

    tmp_path.unlink()


def test_registry_sorted_keys():
    """Verify contracts and networks are sorted for deterministic output."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    registry = _run_generate(tmp_path)
    contracts_keys = list(registry["contracts"].keys())
    assert contracts_keys == sorted(contracts_keys), \
        "Contract names are not sorted"

    for name, entry in registry["contracts"].items():
        networks_keys = list(entry["networks"].keys())
        assert networks_keys == sorted(networks_keys), \
            f"Network keys for {name} are not sorted"

    tmp_path.unlink()


if __name__ == "__main__":
    # Run tests manually when executed directly
    import traceback
    tests = [
        test_registry_includes_all_contracts,
        test_registry_required_fields,
        test_registry_deterministic,
        test_registry_ci_safe,
        test_registry_schema_version,
        test_registry_sorted_keys,
    ]
    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            print(f"✅ {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__}: {e}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
