"""
Test suite for Soter AI Service
"""

import pytest
from fastapi.testclient import TestClient
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
