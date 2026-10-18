#!/usr/bin/env python3
"""Tests for verify-deployment.py."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).with_name("verify-deployment.py")


def _run(project_dir: Path, wasm: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--project-dir",
            str(project_dir),
            "--contract-id",
            "C123",
            "--version",
            "1.0.0",
            "--network",
            "testnet",
            "--wasm",
            str(wasm),
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_matching_artifact_is_verified(tmp_path: Path):
    wasm = tmp_path / "artifact.wasm"
    wasm.write_bytes(b"artifact")
    digest = hashlib.sha256(wasm.read_bytes()).hexdigest()
    registry_dir = tmp_path / "deployments"
    registry_dir.mkdir()
    (registry_dir / "registry.json").write_text(
        json.dumps(
            {
                "deployments": [
                    {
                        "network": "testnet",
                        "version": "1.0.0",
                        "contract_id": "C123",
                        "wasm_hash": digest,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    result = _run(tmp_path, wasm)

    assert result.returncode == 0
    assert json.loads(result.stdout)["verified"] is True


def test_different_artifact_fails_verification(tmp_path: Path):
    wasm = tmp_path / "artifact.wasm"
    wasm.write_bytes(b"artifact")
    registry_dir = tmp_path / "deployments"
    registry_dir.mkdir()
    (registry_dir / "registry.json").write_text(
        json.dumps(
            {
                "deployments": [
                    {
                        "network": "testnet",
                        "version": "1.0.0",
                        "contract_id": "C123",
                        "wasm_hash": "0" * 64,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    result = _run(tmp_path, wasm)

    assert result.returncode != 0
    output = json.loads(result.stdout)
    assert output["verified"] is False
    assert "checksum mismatch" in output["error"]