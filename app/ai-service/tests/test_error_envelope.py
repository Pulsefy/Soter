"""
Tests for the standardized error response envelope (Issue #244).

Every error response must conform to:
  {"error": {"code": str, "message": str, "details": any|null}}
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from main import app
from exceptions import AIServiceError

client = TestClient(app, raise_server_exceptions=False)


def assert_envelope(data: dict, expected_code: str):
    assert "error" in data, f"Missing 'error' key: {data}"
    err = data["error"]
    assert "code" in err and "message" in err, f"Malformed error detail: {err}"
    assert err["code"] == expected_code, f"Expected code {expected_code!r}, got {err['code']!r}"


# ---------------------------------------------------------------------------
# 1. 404 Not Found
# ---------------------------------------------------------------------------
class TestNotFound:
    def test_404_shape(self):
        r = client.get("/v1/ai/nonexistent-route-xyz")
        assert r.status_code == 404
        assert_envelope(r.json(), "HTTP_404")

    def test_404_message_is_string(self):
        r = client.get("/v1/ai/nonexistent-route-xyz")
        assert isinstance(r.json()["error"]["message"], str)


# ---------------------------------------------------------------------------
# 2. 422 Validation Error (missing required field)
# ---------------------------------------------------------------------------
class TestValidationError:
    def test_422_shape(self):
        # /v1/ai/inference expects {"type": ...}; send empty body
        r = client.post("/v1/ai/inference", json={})
        # type has a default so send truly invalid payload
        r = client.post("/v1/ai/inference", content="not-json",
                        headers={"Content-Type": "application/json"})
        assert r.status_code == 422
        assert_envelope(r.json(), "VALIDATION_ERROR")

    def test_422_details_present(self):
        r = client.post("/v1/ai/inference", content="not-json",
                        headers={"Content-Type": "application/json"})
        assert r.json()["error"]["details"] is not None


# ---------------------------------------------------------------------------
# 3. 401 Unauthorized
# ---------------------------------------------------------------------------
class TestUnauthorized:
    def test_401_shape(self):
        # Inject a 401 via a dedicated test route registered on the app
        from fastapi import HTTPException as FHTTPException

        @app.get("/_test/401")
        async def _raise_401():
            raise FHTTPException(status_code=401, detail="Unauthorized")

        r = client.get("/_test/401")
        assert r.status_code == 401
        assert_envelope(r.json(), "HTTP_401")


# ---------------------------------------------------------------------------
# 4. AI service timeout / failure (AIServiceError → 502)
# ---------------------------------------------------------------------------
class TestAIServiceError:
    def test_ai_error_shape(self):
        @app.get("/_test/ai-failure")
        async def _raise_ai_error():
            raise AIServiceError(
                message="LLM request timed out",
                code="AI_TIMEOUT",
                details={"provider": "openai", "timeout_seconds": 30},
            )

        r = client.get("/_test/ai-failure")
        assert r.status_code == 502
        assert_envelope(r.json(), "AI_TIMEOUT")

    def test_ai_error_details(self):
        r = client.get("/_test/ai-failure")
        assert r.json()["error"]["details"]["provider"] == "openai"


# ---------------------------------------------------------------------------
# 5. Generic 500 Internal Server Error
# ---------------------------------------------------------------------------
class TestInternalServerError:
    def test_500_shape(self):
        @app.get("/_test/500")
        async def _raise_500():
            raise RuntimeError("Unexpected boom")

        r = client.get("/_test/500")
        assert r.status_code == 500
        assert_envelope(r.json(), "INTERNAL_SERVER_ERROR")

    def test_500_no_leak(self):
        """Internal error details must not leak to the client."""
        r = client.get("/_test/500")
        assert "boom" not in r.text
