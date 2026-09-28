import pytest
import io
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from schemas.ocr import OCRResponse
from services.ocr import FieldMatch

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
        # Legacy /ai/ocr returns OCRResponse (old flat shape)
        assert "processing_time_ms" in data

    def test_ocr_endpoint_with_language_hint(self):
        from PIL import Image
        from services.providers import OCRField, OCRResponse

        img = Image.new("RGB", (50, 50), color="blue")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        from services.ocr import OCRResult

        mock_result = OCRResult(
            fields={"name": FieldMatch(value="Test", confidence=0.9)},
            raw_text="Test",
            processing_time_ms=10,
        )

        with patch(
            "api.routes.ocr_service.process_image",
            return_value=mock_result,
        ) as mock_process:
            response = client.post(
                "/ai/ocr",
                files={"image": ("test.png", buf.getvalue(), "image/png")},
                data={"language_hint": "eng"},
            )
        assert response.status_code == 200
        mock_process.assert_called_once()
        call_kwargs = mock_process.call_args[1]
        assert call_kwargs.get("language_hint") == "eng"

    def test_ocr_endpoint_unsupported_language_hint(self):
        from PIL import Image

        img = Image.new("RGB", (50, 50), color="blue")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        response = client.post(
            "/ai/ocr",
            files={"image": ("test.png", buf.getvalue(), "image/png")},
            data={"language_hint": "invalid"},
        )
        assert response.status_code == 422


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
            mock_client.ping.side_effect = redis_lib.exceptions.ConnectionError(
                "refused"
            )
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
