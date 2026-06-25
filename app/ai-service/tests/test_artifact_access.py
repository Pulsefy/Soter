import json
import time
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


def test_access_denied_for_missing_user_role(client: TestClient, artifact_fixture: str):
    """Test that missing X-User-Role header is rejected."""
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-Org-Id": "org-123",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_user_role"


def test_access_denied_for_missing_org_id(client: TestClient, artifact_fixture: str):
    """Test that missing X-Org-Id header is rejected."""
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "admin",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_org_id"


def test_access_denied_for_missing_user_id(client: TestClient, artifact_fixture: str):
    """Test that missing X-User-Id header is rejected."""
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "admin",
            "X-Org-Id": "org-123",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_user_id"


def test_access_denied_for_empty_user_role(client: TestClient, artifact_fixture: str):
    """Test that empty X-User-Role header is rejected."""
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "",
            "X-Org-Id": "org-123",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_user_role"


def test_access_denied_for_empty_org_id(client: TestClient, artifact_fixture: str):
    """Test that empty X-Org-Id header is rejected."""
    response = client.post(
        f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
        headers={
            "X-User-Role": "admin",
            "X-Org-Id": "",
            "X-User-Id": "user-1",
        },
        json={"mode": "signed_url"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_org_id"


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
    assert response.json()["error"]["code"] == "forbidden_role"


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
    assert response.json()["error"]["message"] == "Access denied: artifact belongs to a different organization"


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
    # expires_in_seconds should be in the response
    assert "expires_in_seconds" in payload
    assert payload["expires_in_seconds"] > 0
    assert "signed_url_configured_ttl_seconds" in payload

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


def test_expired_token_rejected(client: TestClient, artifact_fixture: str):
    """Test that expired signed tokens are rejected."""
    import api.v1.artifacts as artifacts_module

    # Set TTL to 1 second
    original_ttl = artifacts_module.artifact_access_service.ttl_seconds
    artifacts_module.artifact_access_service.ttl_seconds = 1

    try:
        # Get a signed URL
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
        download_url = access_response.json()["download_url"]

        # Wait for token to expire
        time.sleep(2)

        # Try to download with expired token
        response = client.get(download_url)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "token_expired"
    finally:
        artifacts_module.artifact_access_service.ttl_seconds = original_ttl


def test_tampered_token_rejected(client: TestClient, artifact_fixture: str):
    """Test that tampered signed tokens are rejected."""
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
    download_url = access_response.json()["download_url"]

    # Extract and tamper with token
    token = download_url.split("token=")[1]
    tampered_token = token[:-5] + "XXXXX"  # Modify last 5 characters

    # Try to download with tampered token
    response = client.get(f"/v1/ai/verification-artifacts/download?token={tampered_token}")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_token_signature"


def test_invalid_token_format_rejected(client: TestClient):
    """Test that malformed tokens are rejected."""
    response = client.get("/v1/ai/verification-artifacts/download?token=notavalidtoken")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_token"


def test_token_org_mismatch_rejected(client: TestClient, artifact_fixture: str):
    """Test that tokens with mismatched org are rejected even if signature is valid."""
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
    download_url = access_response.json()["download_url"]
    
    # Create a valid token for a different org
    import api.v1.artifacts as artifacts_module
    
    valid_token = artifacts_module.artifact_access_service.create_signed_token(
        artifact_fixture, "org-999", "user-1"
    )
    
    # Try to download with token from different org
    response = client.get(f"/v1/ai/verification-artifacts/download?token={valid_token}")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden_org"


def test_all_authorized_roles_have_access(client: TestClient, artifact_fixture: str):
    """Test that all authorized roles (admin, operator, reviewer) can access artifacts."""
    for role in ["admin", "operator", "reviewer"]:
        response = client.post(
            f"/v1/ai/verification-artifacts/{artifact_fixture}/access",
            headers={
                "X-User-Role": role,
                "X-Org-Id": "org-123",
                "X-User-Id": "user-1",
            },
            json={"mode": "signed_url"},
        )
        assert response.status_code == 200, f"Role {role} should have access"
        assert "download_url" in response.json()

