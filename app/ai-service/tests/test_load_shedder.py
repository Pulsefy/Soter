"""
Tests for load-shedding behavior (Issue #621).
"""

from unittest.mock import MagicMock, patch

import metrics
import pytest
from fastapi.testclient import TestClient

import main
import tasks
from exceptions import LoadShedError
from services.load_shedder import (
    build_shed_response,
    check_memory_pressure,
    check_queue_pressure,
    evaluate_load_shed,
    ensure_queue_capacity,
    record_shed_request,
    _priority_multiplier,
    _task_requires_llm_provider,
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


class TestPriorityAwareQueuePressure:
    """Issue #777: queue-depth threshold scales with declared job priority."""

    def test_priority_multiplier_known_tiers(self):
        assert _priority_multiplier("low") == 0.5
        assert _priority_multiplier("normal") == 1.0
        assert _priority_multiplier("high") == 1.5
        assert _priority_multiplier("urgent") == 3.0

    def test_priority_multiplier_defaults_to_normal(self):
        assert _priority_multiplier(None) == 1.0
        assert _priority_multiplier("not-a-real-tier") == 1.0
        assert _priority_multiplier("URGENT") == 3.0  # case-insensitive

    def test_low_priority_shed_below_normal_threshold(self):
        # depth=60 is under the flat max (100) but over the "low" tier's
        # scaled threshold (100 * 0.5 = 50), so low-priority jobs get shed
        # while normal-priority jobs at the same depth would not be.
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=60
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_max_celery_queue_depth = 100
            result = check_queue_pressure(priority="low")
        assert result is not None
        reason, details = result
        assert reason == "queue_full"
        assert details["priority"] == "low"
        assert details["effective_max_queue_depth"] == 50

    def test_normal_priority_not_shed_at_same_depth(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=60
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_max_celery_queue_depth = 100
            result = check_queue_pressure(priority="normal")
        assert result is None

    def test_urgent_priority_tolerates_deeper_queue(self):
        # depth=120 exceeds the flat max (100) but not the "urgent" tier's
        # scaled threshold (100 * 3.0 = 300).
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=120
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_max_celery_queue_depth = 100
            result = check_queue_pressure(priority="urgent")
        assert result is None

    def test_unspecified_priority_matches_pre_issue_777_behavior(self):
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
        assert details["priority"] == "normal"


class TestProviderAwareJobCreation:
    """Issue #777: async jobs needing an LLM provider are shed before queuing."""

    def test_llm_dependent_task_type_detected(self):
        assert _task_requires_llm_provider("humanitarian_verification") is True
        assert _task_requires_llm_provider("ocr") is False
        assert _task_requires_llm_provider(None) is False

    def test_ensure_queue_capacity_sheds_llm_dependent_job_when_providers_down(self):
        with patch(
            "services.load_shedder.check_queue_pressure", return_value=None
        ), patch("services.load_shedder.are_llm_providers_down", return_value=True):
            with pytest.raises(LoadShedError) as exc_info:
                ensure_queue_capacity(task_type="humanitarian_verification")
        assert exc_info.value.reason == "provider_down"

    def test_ensure_queue_capacity_ignores_provider_health_for_non_llm_jobs(self):
        with patch(
            "services.load_shedder.check_queue_pressure", return_value=None
        ), patch("services.load_shedder.are_llm_providers_down", return_value=True):
            ensure_queue_capacity(task_type="ocr")  # should not raise

    def test_ensure_queue_capacity_checks_queue_before_provider(self):
        # Queue pressure should short-circuit before the provider check runs.
        with patch(
            "services.load_shedder.check_queue_pressure",
            return_value=("queue_full", {"queue_depth": 999}),
        ), patch(
            "services.load_shedder.are_llm_providers_down", return_value=True
        ) as mock_provider_check:
            with pytest.raises(LoadShedError) as exc_info:
                ensure_queue_capacity(task_type="humanitarian_verification")
        assert exc_info.value.reason == "queue_full"
        mock_provider_check.assert_not_called()


class TestQueueShedMetricByPriority:
    def test_queue_full_shed_increments_priority_metric(self):
        before = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="low")._value.get()
        record_shed_request("queue_full", "POST", "/v1/ai/inference", priority="low")
        after = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="low")._value.get()
        assert after == before + 1

    def test_non_queue_reason_does_not_increment_priority_metric(self):
        before = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="normal")._value.get()
        record_shed_request("memory", "POST", "/v1/ai/anonymize")
        after = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="normal")._value.get()
        assert after == before

    def test_missing_priority_defaults_to_normal_label(self):
        before = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="normal")._value.get()
        record_shed_request("queue_full", "POST", "/v1/ai/inference")
        after = metrics.QUEUE_SHED_BY_PRIORITY_TOTAL.labels(priority="normal")._value.get()
        assert after == before + 1


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

    def test_metrics_endpoint_exposes_priority_shed_counter(self, client):
        record_shed_request("queue_full", "POST", "/v1/ai/inference", priority="low")
        response = client.get("/ai/metrics")
        assert response.status_code == 200
        assert "queue_shed_by_priority_total" in response.text

    def test_low_priority_job_creation_shed_with_consistent_envelope(self, client, monkeypatch):
        """
        End-to-end: a low-priority job hits the priority-scaled queue
        threshold inside tasks.create_task (not the middleware pre-check)
        and still comes back as a standard SERVICE_OVERLOADED envelope.
        """
        monkeypatch.setattr(tasks, "get_process_heavy_inference_task", lambda: MagicMock())

        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=60
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_max_celery_queue_depth = 100

            response = client.post(
                "/v1/ai/inference",
                json={"type": "inference", "priority": "low"},
            )

        assert response.status_code == 503
        data = response.json()
        assert_shed_envelope(data, "queue_full")
        assert data["error"]["details"]["priority"] == "low"

    def test_llm_dependent_job_creation_shed_when_providers_down(self, client, monkeypatch):
        monkeypatch.setattr(tasks, "get_process_heavy_inference_task", lambda: MagicMock())

        with patch(
            "services.load_shedder.check_queue_pressure", return_value=None
        ), patch("services.load_shedder.are_llm_providers_down", return_value=True):
            response = client.post(
                "/v1/ai/inference",
                json={"type": "humanitarian_verification", "data": {"aid_claim": "x"}},
            )

        assert response.status_code == 503
        assert_shed_envelope(response.json(), "provider_down")


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
