import json
from pathlib import Path
from unittest.mock import patch

import metrics
import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture()
def client():
    return TestClient(main.app, follow_redirects=False)


@pytest.fixture()
def artifact_fixture(tmp_path: Path):
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    artifact_id = "evidence-1.bin"
    artifact_path = artifact_dir / artifact_id
    artifact_path.write_bytes(b"secure-evidence")

    metadata = {
        "org_id": "org-123",
        "filename": "evidence.bin",
        "mime_type": "application/octet-stream",
    }
    (artifact_dir / f"{artifact_id}.meta.json").write_text(
        json.dumps(metadata), encoding="utf-8"
    )

    import api.v1.artifacts as artifacts_module

    artifacts_module.artifact_access_service.artifacts_dir = str(artifact_dir.resolve())
    artifacts_module.artifact_access_service.ttl_seconds = 60

    return artifact_id


def test_access_denied_for_invalid_role(client: TestClient, artifact_fixture: str):
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "viewer",
            "X-Org-Id": "org-123",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden_role"


def test_access_denied_for_wrong_org(client: TestClient, artifact_fixture: str):
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "reviewer",
            "X-Org-Id": "org-999",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden_org"


def test_signed_url_and_download(client: TestClient, artifact_fixture: str):
    access_response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "admin",
            "X-Org-Id": "org-123",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert access_response.status_code == 200
    payload = access_response.json()
    assert "download_url" in payload

    download_url = payload["download_url"]
    response = client.get(download_url)
    assert response.status_code == 200
    assert response.content == b"secure-evidence"


def test_proxy_mode_returns_file(client: TestClient, artifact_fixture: str):
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "operator",
            "X-Org-Id": "org-123",
            "X-User-Id": "user-2",
        },
        json={"mode": "proxy"},
    )
    assert response.status_code == 200
    assert response.content == b"secure-evidence"
