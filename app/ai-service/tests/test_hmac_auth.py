import hashlib
import hmac
import time
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.hmac_auth import HMACAuthMiddleware


@pytest.fixture
def secret_key():
    return "test-secret-key-12345"


@pytest.fixture
def app(secret_key):
    app = FastAPI()
    app.add_middleware(HMACAuthMiddleware, secret_key=secret_key)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/ai/test")
    async def protected_endpoint():
        return {"message": "success"}

    @app.get("/")
    async def root():
        return {"service": "test"}

    return app


@pytest.fixture
def client(app):
    return TestClient(app)


def generate_signature(method: str, path: str, timestamp: str, body: bytes, secret_key: str) -> str:
    payload = f"{method}{path}{timestamp}".encode("utf-8") + body
    return hmac.new(secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


class TestHMACAuthMiddleware:
    def test_excluded_paths_bypass_auth(self, client):
        response = client.get("/health")
        assert response.status_code == 200

        response = client.get("/")
        assert response.status_code == 200

    def test_missing_signature_returns_403(self, client):
        response = client.post("/ai/test")
        assert response.status_code == 403
        assert "Missing HMAC signature" in response.json()["detail"]

    def test_missing_timestamp_returns_403(self, client, secret_key):
        headers = {"X-HMAC-Signature": "some-signature"}
        response = client.post("/ai/test", headers=headers)
        assert response.status_code == 403
        assert "Missing HMAC signature" in response.json()["detail"]

    def test_invalid_timestamp_format_returns_403(self, client, secret_key):
        headers = {
            "X-HMAC-Signature": "some-signature",
            "X-HMAC-Timestamp": "not-a-number",
        }
        response = client.post("/ai/test", headers=headers)
        assert response.status_code == 403
        assert "Invalid timestamp format" in response.json()["detail"]

    def test_expired_timestamp_returns_403(self, client, secret_key):
        old_timestamp = str(int(time.time()) - 400)
        body = b""
        signature = generate_signature("POST", "/ai/test", old_timestamp, body, secret_key)
        headers = {
            "X-HMAC-Signature": signature,
            "X-HMAC-Timestamp": old_timestamp,
        }
        response = client.post("/ai/test", headers=headers)
        assert response.status_code == 403
        assert "Request timestamp expired" in response.json()["detail"]

    def test_invalid_signature_returns_403(self, client, secret_key):
        timestamp = str(int(time.time()))
        headers = {
            "X-HMAC-Signature": "invalid-signature",
            "X-HMAC-Timestamp": timestamp,
        }
        response = client.post("/ai/test", headers=headers)
        assert response.status_code == 403
        assert "Invalid HMAC signature" in response.json()["detail"]

    def test_valid_signature_allows_request(self, client, secret_key):
        timestamp = str(int(time.time()))
        body = b""
        signature = generate_signature("POST", "/ai/test", timestamp, body, secret_key)
        headers = {
            "X-HMAC-Signature": signature,
            "X-HMAC-Timestamp": timestamp,
        }
        response = client.post("/ai/test", headers=headers)
        assert response.status_code == 200
        assert response.json()["message"] == "success"

    def test_valid_signature_with_body(self, client, secret_key):
        timestamp = str(int(time.time()))
        body = b'{"data": "test"}'
        signature = generate_signature("POST", "/ai/test", timestamp, body, secret_key)
        headers = {
            "X-HMAC-Signature": signature,
            "X-HMAC-Timestamp": timestamp,
            "Content-Type": "application/json",
        }
        response = client.post("/ai/test", headers=headers, content=body)
        assert response.status_code == 200

    def test_signature_mismatch_with_different_body_returns_403(self, client, secret_key):
        timestamp = str(int(time.time()))
        body = b'{"data": "test"}'
        different_body = b'{"data": "modified"}'
        signature = generate_signature("POST", "/ai/test", timestamp, body, secret_key)
        headers = {
            "X-HMAC-Signature": signature,
            "X-HMAC-Timestamp": timestamp,
            "Content-Type": "application/json",
        }
        response = client.post("/ai/test", headers=headers, content=different_body)
        assert response.status_code == 403
        assert "Invalid HMAC signature" in response.json()["detail"]


class TestHMACAuthMiddlewareNoSecret:
    def test_missing_secret_key_returns_500(self):
        app = FastAPI()
        app.add_middleware(HMACAuthMiddleware, secret_key=None)

        @app.post("/ai/test")
        async def protected():
            return {"message": "success"}

        client = TestClient(app)

        with patch("middleware.hmac_auth.settings") as mock_settings:
            mock_settings.hmac_secret_key = None
            headers = {
                "X-HMAC-Signature": "any",
                "X-HMAC-Timestamp": str(int(time.time())),
            }
            response = client.post("/ai/test", headers=headers)
            assert response.status_code == 500
            assert "HMAC secret key not configured" in response.json()["detail"]
