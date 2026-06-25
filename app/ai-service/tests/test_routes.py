import pytest
import io
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from schemas.ocr import OCRResponse


client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_200(self):
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_status(self):
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "soter-ai-service"


class TestOCRRoutes:
    def test_ocr_endpoint_no_image(self):
        response = client.post("/ai/ocr")
        assert response.status_code == 422

    def test_ocr_endpoint_invalid_file_type(self):
        response = client.post(
            "/ai/ocr",
            files={"image": ("test.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 400

    def test_ocr_endpoint_small_image(self):
        from PIL import Image

        img = Image.new("RGB", (50, 50), color="red")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        response = client.post(
            "/ai/ocr",
            files={"image": ("test.png", buf.getvalue(), "image/png")},
        )
        assert response.status_code == 200

    def test_ocr_endpoint_processing_time_recorded(self):
        from PIL import Image

        img = Image.new("RGB", (100, 100), color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        response = client.post(
            "/ai/ocr",
            files={"image": ("test.png", buf.getvalue(), "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "processing_time_ms" in data


class TestRootEndpoint:
    def test_root_returns_welcome(self):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "service" in data
        assert "version" in data


class TestHealthDependenciesEndpoint:
    def test_returns_200(self):
        response = client.get("/health/dependencies")
        assert response.status_code == 200

    def test_response_shape(self):
        response = client.get("/health/dependencies")
        data = response.json()
        assert "status" in data
        assert data["status"] in ("ok", "degraded")
        assert "checks" in data
        checks = data["checks"]
        assert "redis" in checks
        assert "provider_config" in checks
        assert "filesystem" in checks
        for v in checks.values():
            assert "ok" in v

    def test_no_secrets_in_response(self):
        response = client.get("/health/dependencies")
        text = response.text
        # Ensure no API key values leak into the response
        from config import settings
        for secret in filter(None, [settings.openai_api_key, settings.groq_api_key]):
            assert secret not in text

    def test_degraded_when_redis_unavailable(self):
        import redis as redis_lib

        with patch("redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping.side_effect = redis_lib.exceptions.ConnectionError("refused")
            mock_from_url.return_value = mock_client

            response = client.get("/health/dependencies")
            data = response.json()

        assert data["checks"]["redis"]["ok"] is False
        assert data["status"] == "degraded"

    def test_ok_when_all_pass(self):
        with patch("redis.from_url") as mock_from_url:
            mock_client = MagicMock()
            mock_client.ping.return_value = True
            mock_from_url.return_value = mock_client

            with patch("config.Settings.get_active_provider", return_value="openai"):
                response = client.get("/health/dependencies")
                data = response.json()

        assert data["checks"]["redis"]["ok"] is True
        assert data["checks"]["filesystem"]["ok"] is True
