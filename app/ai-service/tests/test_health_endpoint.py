"""Tests for provider health API endpoints (Issue #770).

Coverage
--------
* GET /v1/ai/health/providers — public health endpoint
* GET /v1/ai/health/providers/detail — detailed (operator) endpoint
* Response shape: overall status, per-provider items, degraded/down counts
* No sensitive details leaked in public endpoint
* Degraded and DOWN states reflected correctly
* Recovery: provider transitions back to healthy after success
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

import main
import metrics
from services.provider_health import provider_health_registry, ProviderStatus
from services.circuit_breaker import CircuitBreaker


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture(autouse=True)
def clear_registry():
    provider_health_registry.clear()
    yield
    provider_health_registry.clear()


@pytest.fixture(scope="module")
def client():
    return TestClient(main.app, follow_redirects=False)


class TestPublicHealthEndpoint:
    def test_returns_200(self, client):
        response = client.get("/v1/ai/health/providers")
        assert response.status_code == 200

    def test_response_shape(self, client):
        response = client.get("/v1/ai/health/providers")
        data = response.json()
        assert "overall" in data
        assert "providers" in data
        assert "degraded_count" in data
        assert "down_count" in data
        assert isinstance(data["providers"], list)

    def test_overall_healthy_when_no_failures(self, client):
        response = client.get("/v1/ai/health/providers")
        data = response.json()
        assert data["overall"] == "healthy"
        assert data["down_count"] == 0
        assert data["degraded_count"] == 0

    def test_provider_items_have_required_fields(self, client):
        response = client.get("/v1/ai/health/providers")
        data = response.json()
        for item in data["providers"]:
            assert "name" in item
            assert "status" in item
            assert "circuit_state" in item
            assert item["status"] in ("healthy", "degraded", "down")
            assert item["circuit_state"] in ("CLOSED", "OPEN", "HALF_OPEN")

    def test_no_sensitive_details_leaked(self, client):
        response = client.get("/v1/ai/health/providers")
        text = response.text
        from config import settings
        for secret in filter(None, [settings.openai_api_key, settings.groq_api_key]):
            assert secret not in text
        assert "failure_count" not in text
        assert "error_rate" not in text
        assert "last_failure_at" not in text

    def test_degraded_when_provider_has_consecutive_failures(self, client):
        provider_health_registry.record_failure("openai")
        provider_health_registry.record_failure("openai")
        response = client.get("/v1/ai/health/providers")
        data = response.json()
        openai_item = next(
            (p for p in data["providers"] if p["name"] == "openai"), None
        )
        assert openai_item is not None
        assert openai_item["status"] == "degraded"
        assert data["degraded_count"] >= 1

    def test_down_when_circuit_open(self, client):
        with patch("api.v1.health._get_circuit_breakers") as mock_get_cbs:
            cb = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=60.0)
            cb.record_failure()
            mock_get_cbs.return_value = {"openai": cb}
            response = client.get("/v1/ai/health/providers")
        data = response.json()
        openai_item = next(
            (p for p in data["providers"] if p["name"] == "openai"), None
        )
        assert openai_item is not None
        assert openai_item["status"] == "down"
        assert openai_item["circuit_state"] == "OPEN"
        assert data["down_count"] >= 1

    def test_overall_degraded_when_one_down_one_healthy(self, client):
        with patch("api.v1.health._get_circuit_breakers") as mock_get_cbs:
            cb_open = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=60.0)
            cb_open.record_failure()
            cb_closed = CircuitBreaker("groq", failure_threshold=3, recovery_timeout=60.0)
            mock_get_cbs.return_value = {"openai": cb_open, "groq": cb_closed}
            response = client.get("/v1/ai/health/providers")
        data = response.json()
        assert data["overall"] == "degraded"
        assert data["down_count"] >= 1

    def test_overall_down_when_all_providers_down(self, client):
        with patch("api.v1.health._get_circuit_breakers") as mock_get_cbs:
            cb1 = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=60.0)
            cb1.record_failure()
            cb2 = CircuitBreaker("groq", failure_threshold=1, recovery_timeout=60.0)
            cb2.record_failure()
            mock_get_cbs.return_value = {"openai": cb1, "groq": cb2}
            response = client.get("/v1/ai/health/providers")
        data = response.json()
        assert data["overall"] == "down"
        assert data["down_count"] >= 2

    def test_recovery_to_healthy_after_success(self, client):
        provider_health_registry.record_failure("openai")
        provider_health_registry.record_failure("openai")
        provider_health_registry.record_success("openai")
        response = client.get("/v1/ai/health/providers")
        data = response.json()
        openai_item = next(
            (p for p in data["providers"] if p["name"] == "openai"), None
        )
        assert openai_item is not None
        assert openai_item["status"] == "healthy"


class TestDetailHealthEndpoint:
    def test_returns_200(self, client):
        response = client.get("/v1/ai/health/providers/detail")
        assert response.status_code == 200

    def test_includes_internal_counters(self, client):
        provider_health_registry.record_failure("openai")
        response = client.get("/v1/ai/health/providers/detail")
        data = response.json()
        assert "overall" in data
        assert "providers" in data
        openai_detail = next(
            (p for p in data["providers"] if p["name"] == "openai"), None
        )
        assert openai_detail is not None
        assert "failure_count" in openai_detail
        assert "consecutive_failures" in openai_detail
        assert "error_rate" in openai_detail

    def test_no_api_keys_in_detail(self, client):
        response = client.get("/v1/ai/health/providers/detail")
        text = response.text
        from config import settings
        for secret in filter(None, [settings.openai_api_key, settings.groq_api_key]):
            assert secret not in text


class TestLegacyRedirect:
    def test_health_providers_not_redirected(self, client):
        response = client.get("/ai/health/providers")
        assert response.status_code == 404