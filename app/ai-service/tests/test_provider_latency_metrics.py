"""
Tests for per-provider response latency histogram and SLA latency alerts.

Validates:
1. Per-provider response latency is recorded as a histogram metric (PROVIDER_RESPONSE_LATENCY).
2. Configurable latency threshold triggers an alert (latency_exceeded) independent of outright failures.
3. Latency below threshold does not alert.
4. Per-provider threshold overrides work correctly.
5. De-duplication window suppresses duplicate alerts for the same provider within the window.
6. Metric is populated across a real request cycle in humanitarian verification.
"""

import json
from unittest.mock import patch, MagicMock
import pytest

from config import settings
import metrics
from services.circuit_breaker import CLOSED
import services.circuit_breaker_alerts as alerts
from services.circuit_breaker_alerts import (
    ALERT_EVENT_LATENCY_EXCEEDED,
    CircuitBreakerAlerter,
    CircuitBreakerAlertPayload,
    notify_provider_latency,
)
from services.humanitarian_verification import HumanitarianVerificationService
from services.providers import LLMResponse


def histogram_sample_count(histogram, **labels):
    """Return the sample count for a histogram matching given labels."""
    data = histogram.collect()[0]
    for sample in data.samples:
        if sample.name.endswith("_count") and all(
            sample.labels.get(k) == v for k, v in labels.items()
        ):
            return sample.value
    return 0


def histogram_sample_sum(histogram, **labels):
    """Return the sample sum for a histogram matching given labels."""
    data = histogram.collect()[0]
    for sample in data.samples:
        if sample.name.endswith("_sum") and all(
            sample.labels.get(k) == v for k, v in labels.items()
        ):
            return sample.value
    return 0.0


@pytest.fixture(autouse=True)
def reset_alerter_state():
    alerts.reset_alerter_for_tests()
    yield
    alerts.reset_alerter_for_tests()


class TestProviderLatencyHistogram:
    def test_record_provider_latency_updates_histogram(self):
        before_count = histogram_sample_count(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test-provider-a"
        )
        before_sum = histogram_sample_sum(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test-provider-a"
        )

        metrics.record_provider_latency("test-provider-a", 1.25)
        metrics.record_provider_latency("test-provider-a", 2.75)

        after_count = histogram_sample_count(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test-provider-a"
        )
        after_sum = histogram_sample_sum(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test-provider-a"
        )

        assert after_count == before_count + 2
        assert pytest.approx(after_sum) == before_sum + 4.0


class TestProviderLatencyAlerts:
    def test_latency_exceeding_default_threshold_triggers_alert(self):
        delivered = []
        alerter = CircuitBreakerAlerter(
            webhook_url="http://alerts.test/webhook",
            background=False,
            dedup_seconds=0,
            deliver_fn=lambda url, body, headers: delivered.append((url, body, headers)),
        )

        # Threshold is default 5.0s, duration 6.2s -> alert
        dispatched = alerter.notify_latency(
            provider="openai",
            duration_seconds=6.2,
            threshold_seconds=5.0,
        )

        assert dispatched is True
        assert len(delivered) == 1
        url, body, headers = delivered[0]
        payload = json.loads(body.decode("utf-8"))

        assert payload["alertType"] == "circuit_breaker"
        assert payload["event"] == ALERT_EVENT_LATENCY_EXCEEDED
        assert payload["provider"] == "openai"
        assert payload["latencySeconds"] == 6.2
        assert payload["latencyThresholdSeconds"] == 5.0
        assert "latency_exceeded" in payload["reason"]

    def test_latency_below_threshold_does_not_alert(self):
        delivered = []
        alerter = CircuitBreakerAlerter(
            webhook_url="http://alerts.test/webhook",
            background=False,
            dedup_seconds=0,
            deliver_fn=lambda url, body, headers: delivered.append((url, body, headers)),
        )

        # Threshold 5.0s, duration 3.5s -> no alert
        dispatched = alerter.notify_latency(
            provider="openai",
            duration_seconds=3.5,
            threshold_seconds=5.0,
        )

        assert dispatched is False
        assert len(delivered) == 0

    def test_per_provider_threshold_override(self, monkeypatch):
        delivered = []
        alerter = CircuitBreakerAlerter(
            webhook_url="http://alerts.test/webhook",
            background=False,
            dedup_seconds=0,
            deliver_fn=lambda url, body, headers: delivered.append((url, body, headers)),
        )
        alerts.set_global_alerter(alerter)

        # Set global threshold 5.0, but groq overridden to 2.0
        monkeypatch.setattr(settings, "provider_latency_alert_threshold_seconds", 5.0)
        monkeypatch.setattr(
            settings, "provider_latency_thresholds", {"groq": 2.0}
        )

        # 3.0s is under default (5.0) but exceeds groq's override (2.0)
        dispatched = notify_provider_latency(provider="groq", duration_seconds=3.0)
        assert dispatched is True
        assert len(delivered) == 1
        payload = json.loads(delivered[0][1].decode("utf-8"))
        assert payload["provider"] == "groq"
        assert payload["latencyThresholdSeconds"] == 2.0

        # openai uses default 5.0, so 3.0s does not alert
        dispatched_openai = notify_provider_latency(
            provider="openai", duration_seconds=3.0
        )
        assert dispatched_openai is False
        assert len(delivered) == 1

    def test_latency_alert_deduplication(self):
        delivered = []
        alerter = CircuitBreakerAlerter(
            webhook_url="http://alerts.test/webhook",
            background=False,
            dedup_seconds=300,
            deliver_fn=lambda url, body, headers: delivered.append((url, body, headers)),
        )

        # First alert goes through
        assert alerter.notify_latency("openai", 7.0, 5.0) is True
        assert len(delivered) == 1
        assert alerter.sent_count == 1

        # Second alert within 300s window is suppressed
        assert alerter.notify_latency("openai", 8.0, 5.0) is False
        assert len(delivered) == 1
        assert alerter.suppressed_count == 1

        # Different provider goes through
        assert alerter.notify_latency("groq", 6.0, 5.0) is True
        assert len(delivered) == 2


class TestRealRequestCycleLatencyMetric:
    def test_metric_populated_across_real_verification_request_cycle(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        service = HumanitarianVerificationService()

        before_count = histogram_sample_count(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test"
        )

        result = service.verify_claim(
            aid_claim="Aid claim for latency metric verification cycle test.",
            supporting_evidence=["evidence_1"],
            context_factors={"location": "test-zone"},
            provider_preference="auto",
        )

        assert result["provider"] == "test"
        assert result["verification"]["verdict"] in {
            "credible",
            "inconclusive",
            "not_credible",
        }

        after_count = histogram_sample_count(
            metrics.PROVIDER_RESPONSE_LATENCY, provider="test"
        )
        assert after_count == before_count + 1
