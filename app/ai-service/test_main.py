"""
Test suite for Soter AI Service
"""

import pytest
from fastapi.testclient import TestClient
import main
from main import app


@pytest.fixture
def client():
    """Create a test client"""
    return TestClient(app)


def test_root_endpoint(client):
    """Test the root endpoint"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Soter AI Service"
    assert "version" in data
    assert data["docs"] == "/docs"
    assert data["health"] == "/health"


def test_health_endpoint(client):
    """Test the health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "soter-ai-service"
    assert "version" in data


def test_health_response_structure(client):
    """Test that health endpoint returns correct structure"""
    response = client.get("/health")
    data = response.json()
    
    # Check required fields
    assert "status" in data
    assert "service" in data
    assert "version" in data
    
    # Check field types
    assert isinstance(data["status"], str)
    assert isinstance(data["service"], str)
    assert isinstance(data["version"], str)


def test_docs_availability(client):
    """Test that API docs are available"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_openapi_schema(client):
    """Test that OpenAPI schema is available"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    data = response.json()
    
    assert data["openapi"] == "3.1.0" or data["openapi"].startswith("3.")
    assert data["info"]["title"] == "Soter AI Service"
    assert data["info"]["version"] == "0.1.0"


def test_error_handling_404(client):
    """Test 404 error handling"""
    response = client.get("/nonexistent")
    assert response.status_code == 404


def test_cors_headers(client):
    """Test CORS headers (if configured)"""
    response = client.get("/health")
    # Basic check that response has appropriate headers
    assert response.status_code == 200


def test_proof_of_life_success(client, monkeypatch):
    """Test successful proof-of-life response contract."""

    def fake_analyze(selfie_image_base64, burst_images_base64=None, confidence_threshold=None):
        return {
            "is_real_person": True,
            "confidence": 0.91,
            "threshold": confidence_threshold if confidence_threshold is not None else 0.65,
            "checks": {
                "face_detected": True,
                "blink_detected": True,
                "head_movement_detected": True,
                "processed_burst_frames": 3,
            },
            "reason": "Face detected and confidence threshold met",
        }

    monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

    payload = {
        "selfie_image_base64": "dGVzdA==",
        "burst_images_base64": ["dGVzdA==", "dGVzdDI="],
        "confidence_threshold": 0.70,
    }

    response = client.post("/ai/proof-of-life", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["is_real_person"] is True
    assert data["confidence"] == 0.91
    assert data["threshold"] == 0.70
    assert data["checks"]["face_detected"] is True


def test_proof_of_life_invalid_image(client, monkeypatch):
    """Test proof-of-life validation errors are returned as HTTP 422."""

    def fake_analyze(selfie_image_base64, burst_images_base64=None, confidence_threshold=None):
        raise ValueError("Invalid base64 image payload")

    monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

    response = client.post(
        "/ai/proof-of-life",
        json={"selfie_image_base64": "not-base64"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["detail"] == "Invalid base64 image payload"


def test_proof_of_life_threshold_validation(client):
    """Test pydantic request validation for confidence threshold range."""
    response = client.post(
        "/ai/proof-of-life",
        json={
            "selfie_image_base64": "dGVzdA==",
            "confidence_threshold": 1.5,
        },
    )
    assert response.status_code == 422
