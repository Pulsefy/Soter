import pytest
import io
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
