"""
Tests for load-shedding behavior (Issue #621).
"""

from unittest.mock import patch

import metrics
import pytest
from fastapi.testclient import TestClient

import main
from exceptions import LoadShedError
from services.load_shedder import (
    build_shed_response,
    check_memory_pressure,
    check_queue_pressure,
    evaluate_load_shed,
    ensure_queue_capacity,
    record_shed_request,
)


@pytest.fixture
def client():
    return TestClient(main.app, follow_redirects=True)


def assert_shed_envelope(data: dict, expected_reason: str):
    assert "error" in data
    err = data["error"]
    assert err["code"] == "SERVICE_OVERLOADED"
    assert isinstance(err["message"], str)
    assert err["details"]["reason"] == expected_reason


class TestLoadShedResponse:
    def test_build_shed_response_shape(self):
        import json

        response = build_shed_response("memory", "POST", "/v1/ai/anonymize")
        assert response.status_code == 503
        assert response.headers["retry-after"] == "30"
        assert_shed_envelope(json.loads(response.body.decode()), "memory")

    def test_record_shed_request_increments_metric(self):
        before = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="queue_full", method="POST", endpoint="/v1/ai/inference"
        )._value.get()
        record_shed_request("queue_full", "POST", "/v1/ai/inference")
        after = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="queue_full", method="POST", endpoint="/v1/ai/inference"
        )._value.get()
        assert after == before + 1


class TestMemoryPressure:
    def test_memory_pressure_detected(self):
        with patch.object(metrics, "check_system_resources", return_value=False):
            assert check_memory_pressure() == "memory"

    def test_memory_pressure_healthy(self):
        with patch.object(metrics, "check_system_resources", return_value=True):
            assert check_memory_pressure() is None


class TestQueuePressure:
    def test_queue_full(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=150
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_max_celery_queue_depth = 100
            result = check_queue_pressure()
        assert result is not None
        reason, details = result
        assert reason == "queue_full"
        assert details["queue_depth"] == 150

    def test_broker_unavailable_does_not_shed(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=None
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            result = check_queue_pressure()
        assert result is None

    def test_inference_reaches_validation_when_broker_unreachable(self, client):
        with patch("services.load_shedder.get_celery_queue_depth", return_value=None):
            response = client.post(
                "/v1/ai/inference",
                content="not-json",
                headers={"Content-Type": "application/json"},
            )
        assert response.status_code == 422

    def test_ensure_queue_capacity_raises(self):
        with patch(
            "services.load_shedder.check_queue_pressure",
            return_value=("queue_full", {"queue_depth": 120}),
        ):
            with pytest.raises(LoadShedError) as exc_info:
                ensure_queue_capacity()
        assert exc_info.value.reason == "queue_full"


class TestMiddlewareLoadShedding:
    def test_v1_endpoint_shed_on_memory_pressure(self, client):
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = client.post(
                "/v1/ai/anonymize",
                json={"text": "Some text with Jane Smith in Lagos."},
            )
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "memory")

    def test_health_never_shed(self, client):
        with patch.object(metrics, "check_system_resources", return_value=False):
            response = client.get("/health")
        assert response.status_code == 200

    def test_inference_shed_when_queue_full(self, client):
        with patch(
            "services.load_shedder.check_queue_pressure",
            return_value=("queue_full", {"queue_depth": 200}),
        ):
            response = client.post("/v1/ai/inference", json={"type": "inference"})
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "queue_full")

    def test_humanitarian_shed_when_providers_down(self, client):
        with patch("services.load_shedder.are_llm_providers_down", return_value=True):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Need food assistance"},
            )
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "provider_down")

    def test_metrics_endpoint_exposes_shed_counter(self, client):
        record_shed_request("memory", "POST", "/v1/ai/anonymize")
        response = client.get("/ai/metrics")
        assert response.status_code == 200
        assert "requests_shed_total" in response.text


class TestLoadShedExceptionHandler:
    def test_handler_returns_envelope(self, client):
        @main.app.get("/_test/load-shed")
        async def _raise_load_shed():
            raise LoadShedError(
                "broker_unavailable",
                "Service temporarily unavailable: task broker is unreachable",
            )

        response = client.get("/_test/load-shed")
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "broker_unavailable")
