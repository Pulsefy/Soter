"""
Tests for load-shedding behavior (Issue #621, #777).
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
    check_provider_pressure,
    evaluate_load_shed,
    ensure_queue_capacity,
    get_provider_health,
    record_shed_request,
    _normalize_priority,
    _queue_threshold_for_priority,
    _queue_tier_for_depth,
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


class TestPriorityHelpers:
    def test_normalize_priority_valid(self):
        assert _normalize_priority("high") == "high"
        assert _normalize_priority("normal") == "normal"
        assert _normalize_priority("low") == "low"

    def test_normalize_priority_case_and_whitespace(self):
        assert _normalize_priority("  HIGH  ") == "high"
        assert _normalize_priority("Low") == "low"

    def test_normalize_priority_invalid_defaults(self):
        assert _normalize_priority("critical") == "normal"
        assert _normalize_priority("") == "normal"
        assert _normalize_priority(None) == "normal"

    def test_queue_threshold_for_priority(self):
        with patch("services.load_shedder.settings") as s:
            s.load_shed_queue_depth_low_priority = 10
            s.load_shed_queue_depth_normal_priority = 20
            s.load_shed_queue_depth_high_priority = 40
            assert _queue_threshold_for_priority("low") == 10
            assert _queue_threshold_for_priority("normal") == 20
            assert _queue_threshold_for_priority("high") == 40
            assert _queue_threshold_for_priority("bogus") == 20

    def test_queue_tier_for_depth(self):
        with patch("services.load_shedder.settings") as s:
            s.load_shed_queue_depth_low_priority = 10
            s.load_shed_queue_depth_normal_priority = 20
            s.load_shed_queue_depth_high_priority = 40
            assert _queue_tier_for_depth(0) == "ok"
            assert _queue_tier_for_depth(9) == "ok"
            assert _queue_tier_for_depth(10) == "low_exceeded"
            assert _queue_tier_for_depth(19) == "low_exceeded"
            assert _queue_tier_for_depth(20) == "normal_exceeded"
            assert _queue_tier_for_depth(39) == "normal_exceeded"
            assert _queue_tier_for_depth(40) == "high_exceeded"
            assert _queue_tier_for_depth(1000) == "high_exceeded"


class TestLoadShedResponse:
    def test_build_shed_response_shape(self):
        import json

        response = build_shed_response("memory", "POST", "/v1/ai/anonymize")
        assert response.status_code == 503
        assert response.headers["retry-after"] == "30"
        body = json.loads(response.body.decode())
        assert_shed_envelope(body, "memory")
        assert "shed_at" in body["error"]["details"]
        assert body["error"]["details"]["priority"] == "normal"

    def test_build_shed_response_includes_priority_and_tier(self):
        import json

        response = build_shed_response(
            "queue_full_low",
            "POST",
            "/v1/ai/inference",
            priority="low",
            queue_tier="low_exceeded",
            provider_state="healthy",
        )
        body = json.loads(response.body.decode())
        details = body["error"]["details"]
        assert details["priority"] == "low"
        assert details["reason"] == "queue_full_low"

    def test_record_shed_request_increments_metric(self):
        before = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="queue_full", method="POST", endpoint="/v1/ai/inference"
        )._value.get()
        before_detail = metrics.REQUESTS_SHED_DETAIL.labels(
            reason="queue_full",
            method="POST",
            endpoint="/v1/ai/inference",
            priority="normal",
            queue_tier="unknown",
            provider_state="unknown",
        )._value.get()
        record_shed_request("queue_full", "POST", "/v1/ai/inference")
        after = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="queue_full", method="POST", endpoint="/v1/ai/inference"
        )._value.get()
        after_detail = metrics.REQUESTS_SHED_DETAIL.labels(
            reason="queue_full",
            method="POST",
            endpoint="/v1/ai/inference",
            priority="normal",
            queue_tier="unknown",
            provider_state="unknown",
        )._value.get()
        assert after == before + 1
        assert after_detail == before_detail + 1


class TestMemoryPressure:
    def test_memory_pressure_detected(self):
        with patch.object(metrics, "check_system_resources", return_value=False):
            assert check_memory_pressure() == "memory"

    def test_memory_pressure_healthy(self):
        with patch.object(metrics, "check_system_resources", return_value=True):
            assert check_memory_pressure() is None


class TestQueuePressure:
    def test_queue_full_normal_priority(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=150
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_queue_depth_low_priority = 50
            mock_settings.load_shed_queue_depth_normal_priority = 100
            mock_settings.load_shed_queue_depth_high_priority = 200
            result = check_queue_pressure("normal")
        assert result is not None
        reason, details = result
        assert reason == "queue_full_normal"
        assert details["queue_depth"] == 150
        assert details["priority"] == "normal"
        assert details["threshold_applied"] == 100
        assert details["queue_tier"] == "normal_exceeded"

    def test_queue_full_low_priority_sheds_earlier(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=70
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_queue_depth_low_priority = 50
            mock_settings.load_shed_queue_depth_normal_priority = 100
            mock_settings.load_shed_queue_depth_high_priority = 200
            low_result = check_queue_pressure("low")
            normal_result = check_queue_pressure("normal")
            high_result = check_queue_pressure("high")
        assert low_result is not None
        assert low_result[0] == "queue_full_low"
        assert normal_result is None
        assert high_result is None

    def test_queue_full_high_priority_survives_moderate_pressure(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=150
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_queue_depth_low_priority = 50
            mock_settings.load_shed_queue_depth_normal_priority = 100
            mock_settings.load_shed_queue_depth_high_priority = 200
            high_result = check_queue_pressure("high")
            normal_result = check_queue_pressure("normal")
        assert normal_result is not None
        assert high_result is None

    def test_queue_full_high_exceeded_sheds_everyone(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=250
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            mock_settings.load_shed_queue_depth_low_priority = 50
            mock_settings.load_shed_queue_depth_normal_priority = 100
            mock_settings.load_shed_queue_depth_high_priority = 200
            low_result = check_queue_pressure("low")
            normal_result = check_queue_pressure("normal")
            high_result = check_queue_pressure("high")
        assert low_result is not None and low_result[0] == "queue_full_high"
        assert normal_result is not None and normal_result[0] == "queue_full_high"
        assert high_result is not None and high_result[0] == "queue_full_high"

    def test_broker_unavailable_does_not_shed(self):
        with patch(
            "services.load_shedder.get_celery_queue_depth", return_value=None
        ), patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "production"
            result = check_queue_pressure("normal")
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

    def test_ensure_queue_capacity_respects_priority(self):
        with patch(
            "services.load_shedder.check_queue_pressure",
            return_value=None,
        ) as mock_check:
            ensure_queue_capacity(priority="high")
            mock_check.assert_called_once_with("high")


class TestProviderHealth:
    def test_get_provider_health_test_env_returns_healthy(self):
        with patch("services.load_shedder.settings") as mock_settings:
            mock_settings.app_env = "test"
            mock_settings.test_provider_mode = False
            state, avail, conf = get_provider_health()
        assert state == "healthy"
        assert avail == 1
        assert conf == 1

    def test_check_provider_pressure_unavailable_sheds_all(self):
        with patch(
            "services.load_shedder.get_provider_health",
            return_value=("unavailable", 0, 2),
        ):
            low = check_provider_priority = check_provider_pressure("low")
            normal = check_provider_pressure("normal")
            high = check_provider_pressure("high")
        assert low is not None and low[0] == "provider_down"
        assert normal is not None and normal[0] == "provider_down"
        assert high is not None and high[0] == "provider_down"
        assert low[1]["available_count"] == 0
        assert low[1]["configured_count"] == 2

    def test_check_provider_pressure_degraded_sheds_only_low(self):
        with patch(
            "services.load_shedder.get_provider_health",
            return_value=("degraded", 1, 3),
        ):
            low = check_provider_pressure("low")
            normal = check_provider_pressure("normal")
            high = check_provider_pressure("high")
        assert low is not None and low[0] == "provider_degraded"
        assert normal is None
        assert high is None
        assert low[1]["provider_state"] == "degraded"

    def test_check_provider_pressure_healthy_admits_all(self):
        with patch(
            "services.load_shedder.get_provider_health",
            return_value=("healthy", 3, 3),
        ):
            assert check_provider_pressure("low") is None
            assert check_provider_pressure("normal") is None
            assert check_provider_pressure("high") is None


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
            return_value=("queue_full_normal", {"queue_depth": 200}),
        ):
            response = client.post("/v1/ai/inference", json={"type": "inference"})
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "queue_full_normal")

    def test_inference_with_high_priority_header_admitted_when_moderate_queue(self, client):
        def fake_check(priority):
            if priority == "high":
                return None
            return ("queue_full_normal", {"queue_depth": 150, "queue_tier": "normal_exceeded"})

        with patch("services.load_shedder.check_queue_pressure", side_effect=fake_check):
            response = client.post(
                "/v1/ai/inference",
                json={"type": "inference", "priority": "high"},
                headers={"X-Job-Priority": "high"},
            )
        assert response.status_code != 503 or (
            response.status_code == 503
            and response.json()["error"]["details"].get("priority") != "high"
        )

    def test_inference_with_low_priority_header_shed_first(self, client):
        calls = []

        def fake_check(priority):
            calls.append(priority)
            if priority == "low":
                return ("queue_full_low", {"queue_depth": 70, "queue_tier": "low_exceeded"})
            return None

        with patch("services.load_shedder.check_queue_pressure", side_effect=fake_check):
            response = client.post(
                "/v1/ai/inference",
                json={"type": "inference", "priority": "low"},
                headers={"X-Job-Priority": "low"},
            )
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "queue_full_low")
        assert any(c == "low" for c in calls)

    def test_humanitarian_shed_when_providers_down(self, client):
        with patch("services.load_shedder.are_llm_providers_down", return_value=True):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Need food assistance"},
            )
        assert response.status_code == 503
        assert_shed_envelope(response.json(), "provider_down")

    def test_humanitarian_degraded_sheds_low_priority_only(self, client):
        def fake_provider(priority):
            if priority == "low":
                return ("provider_degraded", {"provider_state": "degraded", "available_count": 1, "configured_count": 3})
            return None

        with patch("services.load_shedder.check_provider_pressure", side_effect=fake_provider):
            low_resp = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Need food assistance"},
                headers={"X-Job-Priority": "low"},
            )
            normal_resp = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Need food assistance"},
                headers={"X-Job-Priority": "normal"},
            )
        assert low_resp.status_code == 503
        assert_shed_envelope(low_resp.json(), "provider_degraded")
        assert normal_resp.status_code != 503 or (
            normal_resp.status_code == 503
            and normal_resp.json()["error"]["details"].get("reason") != "provider_degraded"
        )

    def test_metrics_endpoint_exposes_shed_counter(self, client):
        record_shed_request("memory", "POST", "/v1/ai/anonymize")
        response = client.get("/ai/metrics")
        assert response.status_code == 200
        assert "requests_shed_total" in response.text
        assert "requests_shed_detail_total" in response.text


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
