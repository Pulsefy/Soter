"""
Tests for versioned API routes – issue #248.

Coverage
--------
* /v1/ai/* endpoints behave identically to their legacy /ai/* counterparts.
* Legacy /ai/* paths that are in the redirect map return 308 pointing to
  the correct /v1 location.
* /ai/ocr and /ai/metrics are explicitly excluded from the redirect map and
  continue to work on their original paths.
* The root endpoint advertises the api_v1 key.
* Health endpoint version field reflects the new version string.

Design note on resource throttling
-----------------------------------
The monitor_requests middleware throttles requests when host RAM > 90 %.
CI / developer machines often cross this threshold.  All tests therefore
patch metrics.check_system_resources to return True (resources healthy)
via a session-scoped autouse fixture, so test outcomes are never
environment-dependent.  The throttle behaviour itself is tested in a
dedicated class that temporarily restores the real implementation.
"""

import io
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

import main
import metrics
from main import app


# ---------------------------------------------------------------------------
# Session-level resource-check bypass
# Every test gets healthy resources unless it opts out explicitly.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    """Patch check_system_resources to always report healthy for all tests."""
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client():
    """TestClient that does NOT follow redirects – lets us inspect 308s."""
    return TestClient(app, follow_redirects=False)


@pytest.fixture(scope="module")
def following_client():
    """TestClient that follows redirects transparently."""
    return TestClient(app, follow_redirects=True)


# ---------------------------------------------------------------------------
# Root / health
# ---------------------------------------------------------------------------


class TestRootEndpoint:
    def test_root_200(self, client):
        assert client.get("/").status_code == 200

    def test_root_advertises_v1(self, client):
        data = client.get("/").json()
        assert "api_v1" in data
        assert data["api_v1"] == "/v1"

    def test_root_version(self, client):
        data = client.get("/").json()
        assert data["version"] == "1.0.0"


class TestHealthEndpoint:
    def test_health_200(self, client):
        assert client.get("/health").status_code == 200

    def test_health_status(self, client):
        data = client.get("/health").json()
        assert data["status"] == "healthy"
        assert data["service"] == "soter-ai-service"

    def test_health_version_updated(self, client):
        data = client.get("/health").json()
        assert data["version"] == "1.0.0"


# ---------------------------------------------------------------------------
# OCR – legacy path stays alive (no redirect)
# ---------------------------------------------------------------------------


class TestOCRLegacyPath:
    def test_legacy_ocr_no_image_returns_422(self, client):
        response = client.post("/ai/ocr")
        assert response.status_code == 422

    def test_legacy_ocr_invalid_type_returns_400(self, client):
        response = client.post(
            "/ai/ocr",
            files={"image": ("file.txt", b"not-an-image", "text/plain")},
        )
        assert response.status_code == 400

    def test_legacy_ocr_valid_image_returns_200(self, client):
        from PIL import Image

        img = Image.new("RGB", (60, 60), color="blue")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        response = client.post(
            "/ai/ocr",
            files={"image": ("img.png", buf.getvalue(), "image/png")},
        )
        assert response.status_code == 200

    def test_legacy_ocr_not_redirected(self, client):
        """Ensure /ai/ocr is NOT intercepted by the redirect middleware."""
        response = client.post(
            "/ai/ocr",
            files={"image": ("img.png", b"x", "image/png")},
        )
        # Any non-3xx response proves we hit the handler, not a redirect.
        assert response.status_code not in (301, 302, 307, 308)


# ---------------------------------------------------------------------------
# v1 OCR endpoint
# ---------------------------------------------------------------------------


class TestOCRV1Path:
    def test_v1_ocr_no_image_returns_422(self, client):
        response = client.post("/v1/ai/ocr")
        assert response.status_code == 422

    def test_v1_ocr_invalid_type_returns_400(self, client):
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("file.txt", b"not-an-image", "text/plain")},
        )
        assert response.status_code == 400

    def test_v1_ocr_valid_image_returns_200(self, client):
        from PIL import Image

        img = Image.new("RGB", (60, 60), color="green")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("img.png", buf.getvalue(), "image/png")},
        )
        assert response.status_code == 200

    def test_v1_ocr_processing_time_present(self, client):
        from PIL import Image

        img = Image.new("RGB", (60, 60), color="red")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("img.png", buf.getvalue(), "image/png")},
        )
        assert response.status_code == 200
        assert "processing_time_ms" in response.json()


# ---------------------------------------------------------------------------
# Redirect behaviour – exact-match paths
# ---------------------------------------------------------------------------


class TestLegacyRedirects:
    """Legacy /ai/* paths must redirect to /v1/ai/* with 308."""

    REDIRECT_CASES = [
        ("POST", "/ai/inference", "/v1/ai/inference"),
        ("POST", "/ai/proof-of-life", "/v1/ai/proof-of-life"),
        ("POST", "/ai/anonymize", "/v1/ai/anonymize"),
        ("POST", "/ai/humanitarian/verify", "/v1/ai/humanitarian/verify"),
    ]

    @pytest.mark.parametrize("method,path,expected_location", REDIRECT_CASES)
    def test_redirect_status_308(self, client, method, path, expected_location):
        response = client.request(method, path, json={})
        assert response.status_code == 308, (
            f"Expected 308 for {method} {path}, got {response.status_code}"
        )

    @pytest.mark.parametrize("method,path,expected_location", REDIRECT_CASES)
    def test_redirect_location_header(self, client, method, path, expected_location):
        response = client.request(method, path, json={})
        assert response.headers.get("location") == expected_location, (
            f"Wrong Location for {method} {path}: {response.headers.get('location')}"
        )


class TestLegacyPrefixRedirects:
    """Parameterised /ai/status/* and /ai/task/* paths must also redirect."""

    def test_status_redirect(self, client):
        response = client.get("/ai/status/abc-123")
        assert response.status_code == 308
        assert response.headers["location"] == "/v1/ai/status/abc-123"

    def test_cancel_redirect(self, client):
        response = client.post("/ai/task/abc-123/cancel")
        assert response.status_code == 308
        assert response.headers["location"] == "/v1/ai/task/abc-123/cancel"


# ---------------------------------------------------------------------------
# v1 endpoints – functional parity with legacy (monkeypatched)
# ---------------------------------------------------------------------------


class TestProofOfLifeV1:
    def test_v1_proof_of_life_success(self, following_client, monkeypatch):
        def fake_analyze(
            selfie_image_base64, burst_images_base64=None, confidence_threshold=None
        ):
            return {
                "is_real_person": True,
                "confidence": 0.92,
                "threshold": confidence_threshold or 0.65,
                "checks": {"face_detected": True},
                "reason": "Face detected",
            }

        monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

        response = following_client.post(
            "/v1/ai/proof-of-life",
            json={"selfie_image_base64": "dGVzdA==", "confidence_threshold": 0.70},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_real_person"] is True
        assert data["confidence"] == 0.92

    def test_v1_proof_of_life_validation_error(self, following_client, monkeypatch):
        def fake_analyze(
            selfie_image_base64, burst_images_base64=None, confidence_threshold=None
        ):
            raise ValueError("bad image")

        monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

        response = following_client.post(
            "/v1/ai/proof-of-life",
            json={"selfie_image_base64": "bad"},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "bad image"

    def test_v1_proof_of_life_threshold_out_of_range(self, following_client):
        response = following_client.post(
            "/v1/ai/proof-of-life",
            json={"selfie_image_base64": "dGVzdA==", "confidence_threshold": 2.0},
        )
        assert response.status_code == 422


class TestAnonymizeV1:
    def test_v1_anonymize_success(self, following_client):
        response = following_client.post(
            "/v1/ai/anonymize",
            json={"text": "On 10 Jan 2025, Mary Doe received aid in Lagos."},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "anonymized_text" in data

    def test_v1_anonymize_empty_text_returns_422(self, following_client):
        response = following_client.post("/v1/ai/anonymize", json={"text": ""})
        assert response.status_code == 422


class TestHumanitarianV1:
    def test_v1_humanitarian_verify_success(self, following_client, monkeypatch):
        def fake_verify(
            aid_claim,
            supporting_evidence=None,
            context_factors=None,
            provider_preference="auto",
        ):
            return {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "prompt_variant": "primary",
                "verification": {
                    "verdict": "credible",
                    "confidence": 0.88,
                    "summary": "Claim is well-supported.",
                },
                "raw_response": "{}",
            }

        monkeypatch.setattr(
            main.humanitarian_verification_service, "verify_claim", fake_verify
        )

        response = following_client.post(
            "/v1/ai/humanitarian/verify",
            json={
                "aid_claim": "Teams distributed kits to all households.",
                "supporting_evidence": ["List #B-17"],
                "context_factors": {},
                "provider_preference": "auto",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["verification"]["verdict"] == "credible"

    def test_v1_humanitarian_verify_failure_path(self, following_client, monkeypatch):
        def fake_verify(
            aid_claim,
            supporting_evidence=None,
            context_factors=None,
            provider_preference="auto",
        ):
            raise RuntimeError("all providers unavailable")

        monkeypatch.setattr(
            main.humanitarian_verification_service, "verify_claim", fake_verify
        )

        response = following_client.post(
            "/v1/ai/humanitarian/verify",
            json={
                "aid_claim": "Claim text.",
                "supporting_evidence": [],
                "context_factors": {},
                "provider_preference": "auto",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "all providers unavailable" in data["error"]


# ---------------------------------------------------------------------------
# Parity: legacy path (via redirect) and v1 path produce same response shape
# ---------------------------------------------------------------------------


class TestLegacyV1Parity:
    """
    Verify that following a legacy redirect gives the same response shape
    as calling /v1 directly.
    """

    def test_anonymize_parity(self, following_client):
        payload = {"text": "Jane Smith received aid in Abuja on 1 March 2025."}

        v1_resp = following_client.post("/v1/ai/anonymize", json=payload)
        legacy_resp = following_client.post("/ai/anonymize", json=payload)

        assert v1_resp.status_code == legacy_resp.status_code == 200
        assert set(v1_resp.json().keys()) == set(legacy_resp.json().keys())
        assert v1_resp.json()["success"] == legacy_resp.json()["success"] is True

    def test_proof_of_life_parity(self, following_client, monkeypatch):
        fake_result = {
            "is_real_person": False,
            "confidence": 0.30,
            "threshold": 0.65,
            "checks": {"face_detected": False},
            "reason": "No face found",
        }

        monkeypatch.setattr(
            main.proof_of_life_analyzer,
            "analyze",
            lambda **kw: fake_result,
        )

        payload = {"selfie_image_base64": "dGVzdA=="}

        v1_resp = following_client.post("/v1/ai/proof-of-life", json=payload)
        legacy_resp = following_client.post("/ai/proof-of-life", json=payload)

        assert v1_resp.status_code == legacy_resp.status_code == 200
        assert v1_resp.json() == legacy_resp.json()

    def test_humanitarian_parity(self, following_client, monkeypatch):
        fake_result = {
            "provider": "anthropic",
            "model": "claude-3",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "unverified",
                "confidence": 0.40,
                "summary": "Insufficient evidence.",
            },
            "raw_response": "{}",
        }

        monkeypatch.setattr(
            main.humanitarian_verification_service,
            "verify_claim",
            lambda **kw: fake_result,
        )

        payload = {
            "aid_claim": "Clinics operational.",
            "supporting_evidence": [],
            "context_factors": {},
            "provider_preference": "auto",
        }

        v1_resp = following_client.post("/v1/ai/humanitarian/verify", json=payload)
        legacy_resp = following_client.post("/ai/humanitarian/verify", json=payload)

        assert v1_resp.status_code == legacy_resp.status_code == 200
        assert set(v1_resp.json().keys()) == set(legacy_resp.json().keys())


# ---------------------------------------------------------------------------
# Metrics endpoint – must NOT be redirected
# ---------------------------------------------------------------------------


class TestMetricsEndpoint:
    def test_metrics_not_redirected(self, client):
        response = client.get("/ai/metrics")
        assert response.status_code != 308

    def test_metrics_returns_content(self, client):
        response = client.get("/ai/metrics")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Resource throttle – verify the 503 path still works for /v1/* endpoints
# ---------------------------------------------------------------------------


class TestResourceThrottle:
    """Verify throttle fires for real AI endpoints but not for infrastructure."""

    def test_v1_endpoint_throttled_when_resources_exhausted(self, following_client):
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = following_client.post(
                "/v1/ai/anonymize",
                json={"text": "Some text with Jane Smith in Lagos."},
            )
        assert response.status_code == 503

    def test_health_never_throttled(self, client):
        """Health endpoint must respond even under resource pressure."""
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = client.get("/health")
        assert response.status_code == 200

    def test_root_never_throttled(self, client):
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = client.get("/")
        assert response.status_code == 200

    def test_redirect_not_throttled(self, client):
        """Legacy redirect paths must always return 308, never 503."""
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = client.post("/ai/anonymize", json={})
        assert response.status_code == 308
