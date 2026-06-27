from pathlib import Path
import sys
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from generate_contract_registry import build_contract_registry, write_contract_registry


def test_build_contract_registry_uses_registry_entries_and_sorts_output(tmp_path):
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "contract": "aid_escrow",
                "deployments": [
                    {
                        "network": "testnet",
                        "version": "0.1.0",
                        "contract_id": "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG",
                        "deployed_at": "2026-06-03",
                    },
                    {
                        "network": "mainnet",
                        "version": "0.2.0",
                        "contract_id": "CBLAH1234567890",
                        "deployed_at": "2026-06-04",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    output_path = tmp_path / "contract-registry.json"
    artifact = build_contract_registry(registry_path)
    write_contract_registry(artifact, output_path)

    written = json.loads(output_path.read_text(encoding="utf-8"))

    assert written["schema_version"] == 1
    assert written["contracts"][0]["name"] == "aid_escrow"
    assert written["contracts"][0]["contract_id"] == "CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG"
    assert written["contracts"][0]["network"] == "testnet"
    assert written["contracts"][0]["version"] == "0.1.0"
    assert written["contracts"][0]["deployed_at"] == "2026-06-03"
    assert written["contracts"][1]["contract_id"] == "CBLAH1234567890"
