"""
Test evidence access control enforcement in humanitarian verification endpoints.

This module tests that evidence artifacts can only be processed by their owning
organization and that cross-org access attempts are denied with proper audit logging.
"""

import pytest
import json
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services.evidence_access_control import (
    EvidenceAccessControl,
    EvidenceAccessControlError,
)
from services.artifact_access import ArtifactAccessError


@pytest.fixture
def artifact_access_control():
    """Fixture for EvidenceAccessControl service."""
    mock_artifact_service = Mock()
    mock_artifact_service.validate_role.return_value = True
    mock_artifact_service.resolve_artifact.return_value = (
        "/path/to/artifact.bin",
        {
            "org_id": "org-123",
            "filename": "test.bin",
            "mime_type": "application/octet-stream",
        },
    )

    def _enforce_org(metadata, org_id):
        # Mimic ArtifactAccessService.enforce_org_ownership: deny if the
        # artifact's org does not match the requester's org.
        if not org_id or not org_id.strip():
            raise ArtifactAccessError("org_id_empty")
        if metadata.get("org_id") != org_id:
            raise ArtifactAccessError("forbidden_org")

    mock_artifact_service.enforce_org_ownership.side_effect = _enforce_org

    return EvidenceAccessControl(mock_artifact_service)


@pytest.fixture
def client_with_app(artifact_access_control):
    """Fixture for TestClient with custom app for testing evidence access control."""
    # Create a test app
    app = FastAPI(
        title="Test Evidence Access Control",
        description="Test evidence access control enforcement",
        version="1.0.0",
    )

    # Configure CORS for testing
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    # Add the humanitarian router which requires evidence access control
    from api.v1.humanitarian import router as humanitarian_router

    # Match the production /v1 prefix added in api/v1/router.py so the
    # endpoint resolves at /v1/ai/humanitarian/verify exactly as it does
    # in deployment.
    app.include_router(humanitarian_router, prefix="/v1")

    # Mirror main.app's HTTPException -> ErrorEnvelope handler so tests
    # see the same error response shape that production emits.
    from fastapi.exceptions import HTTPException as FastAPIHTTPException
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from fastapi.responses import JSONResponse
    from schemas.errors import ErrorDetail, ErrorEnvelope

    async def _http_exception_handler(request, exc):
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code=f"HTTP_{exc.status_code}", message=str(exc.detail)
                )
            ).model_dump(),
        )

    # Register the same handler for both FastAPI and Starlette HTTPExceptions
    # so the fixture mirrors ``main.app``'s coverage of both exception types.
    app.add_exception_handler(FastAPIHTTPException, _http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)

    # Mock services
    app.state.cache = Mock()
    app.state.cache.enabled = False
    app.state.artifact_access_control = artifact_access_control
    app.state.humanitarian_verification_service = Mock()

    app.state.humanitarian_verification_service.verify_claim = Mock(
        return_value={
            "provider": "test",
            "model": "test-provider/fixture",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "credible",
                "confidence": 0.86,
                "summary": "Evidence aligns with claim across key criteria",
            },
        }
    )

    app.state.humanitarian_verification_service.get_model_version = Mock(
        return_value="test:test-provider/fixture"
    )

    yield TestClient(app, follow_redirects=False)


class TestEvidenceAccessControl:
    """Test evidence access control enforcement."""

    def test_evidence_access_control_service(self, artifact_access_control):
        """Test that EvidenceAccessControl service correctly validates evidence."""
        # Test successful validation (same org)
        artifact_access_control.validate_evidence_access(
            artifact_ids=["evidence-1.bin"],
            org_id="org-123",
            user_id="user-1",
            user_role="operator",
            correlation_id="test-123",
        )

        # Verify the underlying service methods were called
        artifact_access_control.artifact_access_service.validate_role.assert_called_with(
            "operator"
        )
        artifact_access_control.artifact_access_service.resolve_artifact.assert_called_with(
            "evidence-1.bin"
        )
        artifact_access_control.artifact_access_service.enforce_org_ownership.assert_called_with(
            {
                "org_id": "org-123",
                "filename": "test.bin",
                "mime_type": "application/octet-stream",
            },
            "org-123",
        )

    def test_cross_org_access_denied(self, artifact_access_control):
        """Test that evidence from different orgs cannot be processed."""
        # Make enforce_org_ownership raise an error for different org
        artifact_access_control.artifact_access_service.resolve_artifact.return_value = (
            "/path/to/artifact.bin",
            {
                "org_id": "org-456",
                "filename": "test.bin",
                "mime_type": "application/octet-stream",
            },
        )

        # Should raise EvidenceAccessControlError when org doesn't match
        with pytest.raises(EvidenceAccessControlError) as exc_info:
            artifact_access_control.validate_evidence_access(
                artifact_ids=["evidence-1.bin"],
                org_id="org-123",  # Different org
                user_id="user-1",
                user_role="operator",
                correlation_id="test-123",
            )

        assert "different organization" in str(exc_info.value)

    def test_no_artifacts_bypass_validation(self, artifact_access_control):
        """Test that requests without artifact references bypass validation."""
        # Should not raise any error when no artifacts are provided
        # (This is just testing the service method, since the actual validation logic
        # is now handled in the endpoint, not the service)
        pass


@pytest.fixture
def test_artifact_fixture(tmp_path):
    """Create a test artifact with metadata."""
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


def test_endpoint_cross_org_access_denied(client_with_app, test_artifact_fixture):
    """Integration test: Evidence from different orgs cannot be processed through endpoint."""
    payload = {
        "aid_claim": "Test claim",
        "supporting_evidence": ["Some evidence"],
        "artifact_ids": [test_artifact_fixture],  # Belongs to org-123
        "provider_preference": "test",
        "context_factors": {},
    }

    response = client_with_app.post(
        "/v1/ai/humanitarian/verify",
        headers={
            "X-User-Role": "operator",
            "X-Org-Id": "org-999",  # Different org
            "X-User-Id": "user-1",
        },
        json=payload,
    )

    # Should be denied - evidence belongs to different org
    assert response.status_code == 403
    body = response.json()
    # Match the main.app ``ErrorEnvelope`` shape produced by the global
    # HTTPException handler in production.  The fixture mounts the same
    # handler below so tests see the canonical envelope.
    message = body.get("error", {}).get("message", "")
    assert "Access denied" in message


def test_endpoint_same_org_access_allowed(client_with_app, test_artifact_fixture):
    """Integration test: Evidence from same org can be processed through endpoint."""
    payload = {
        "aid_claim": "Test claim",
        "supporting_evidence": ["Some evidence"],
        "artifact_ids": [test_artifact_fixture],  # Belongs to org-123
        "provider_preference": "test",
        "context_factors": {},
    }

    response = client_with_app.post(
        "/v1/ai/humanitarian/verify",
        headers={
            "X-User-Role": "operator",
            "X-Org-Id": "org-123",  # Same org
            "X-User-Id": "user-1",
        },
        json=payload,
    )

    # Should be allowed
    assert response.status_code == 200
    assert "result" in response.json()
    assert response.json()["result"]["provider"] == "test"


def test_endpoint_no_artifacts_bypass_validation(client_with_app):
    """Integration test: Requests without artifact references bypass validation."""
    payload = {
        "aid_claim": "Test claim",
        "supporting_evidence": ["Some evidence"],
        "context_factors": {},
    }

    response = client_with_app.post(
        "/v1/ai/humanitarian/verify",
        headers={
            "X-User-Role": "operator",
            "X-Org-Id": "org-123",
            "X-User-Id": "user-1",
        },
        json=payload,
    )

    # Should be allowed - no artifacts to validate
    assert response.status_code == 200
    assert "result" in response.json()
    assert response.json()["result"]["provider"] == "test"


def test_endpoint_audit_logging(client_with_app, test_artifact_fixture, caplog):
    """Integration test: Access attempts are logged for audit."""
    payload = {
        "aid_claim": "Test claim",
        "supporting_evidence": ["Some evidence"],
        "artifact_ids": [test_artifact_fixture],
        "provider_preference": "test",
        "context_factors": {},
    }

    response = client_with_app.post(
        "/v1/ai/humanitarian/verify",
        headers={
            "X-User-Role": "operator",
            "X-Org-Id": "org-999",  # Wrong org
            "X-User-Id": "user-1",
        },
        json=payload,
    )

    # Should be denied
    assert response.status_code == 403

    # ``event`` / ``status`` / ``reason`` / ``artifact_ids`` are passed via
    # ``extra=`` on the log call, so they land on the record as attributes
    # rather than in the rendered message body.  Inspect them directly so
    # the assertion stays decoupled from future message-text tweaks.
    audit_records = [
        r
        for r in caplog.records
        if getattr(r, "event", None) == "evidence_access_check"
    ]
    assert audit_records, "expected an evidence_access_check log record"
    denied_records = [r for r in audit_records if getattr(r, "status", "") == "denied"]
    assert denied_records, "expected at least one denied evidence_access_check record"
    # The denial must identify the cross-org cause, not just be present.
    assert any(getattr(r, "reason", "") == "forbidden_org" for r in denied_records)
    # The denial must reference the artifact we tried to access.
    assert any(
        test_artifact_fixture in getattr(r, "artifact_ids", []) for r in denied_records
    )
