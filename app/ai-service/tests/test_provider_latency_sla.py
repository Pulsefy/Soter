"""
Tests for per-provider response latency SLA metrics.

Coverage
--------
* ``record_provider_latency`` always observes the histogram regardless of
  whether the threshold is breached.
* When latency exceeds the configured SLA threshold, the breach counter is
  incremented and a warning is logged.
* When latency is within the threshold, the breach counter is NOT incremented.
* A zero threshold (SLA checking disabled) never increments the breach counter.
* The humanitarian verification call site wires latency recording correctly
  across at least one real request cycle (via the FixtureProvider).
"""

import logging
from unittest.mock import patch

import pytest

import metrics
from metrics import (
    PROVIDER_RESPONSE_LATENCY_SECONDS,
    PROVIDER_LATENCY_SLA_BREACHES_TOTAL,
    record_provider_latency,
)


def _counter_value(counter, **labels):
    """Return the current value of a counter for the given labels."""
    return counter.labels(**labels)._value.get()


def _histogram_count(histogram, **labels):
    """Return the observation count from a histogram for the given labels."""
    for metric_family in histogram.collect():
        for sample in metric_family.samples:
            if sample.name.endswith("_count") and sample.labels == labels:
                return sample.value
    return 0.0


class TestRecordProviderLatency:
    """Unit tests for the ``record_provider_latency`` helper."""

    def test_always_observes_histogram(self, monkeypatch):
        """The histogram is observed even when below threshold."""
        before = _histogram_count(PROVIDER_RESPONSE_LATENCY_SECONDS, provider="test")
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            10.0,
        )
        record_provider_latency("test", 1.5)
        after = _histogram_count(PROVIDER_RESPONSE_LATENCY_SECONDS, provider="test")
        assert after > before

    def test_breach_counter_incremented_when_above_threshold(self, monkeypatch):
        """Exceeding the threshold increments the breach counter."""
        before = _counter_value(
            PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="openai"
        )
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            2.0,
        )
        record_provider_latency("openai", 3.0)
        after = _counter_value(
            PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="openai"
        )
        assert after == before + 1

    def test_no_breach_when_within_threshold(self, monkeypatch):
        """Latency within the threshold does NOT increment the breach counter."""
        before = _counter_value(PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="groq")
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            10.0,
        )
        record_provider_latency("groq", 2.0)
        after = _counter_value(PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="groq")
        assert after == before

    def test_no_breach_when_exactly_at_threshold(self, monkeypatch):
        """Latency exactly at the threshold does NOT count as a breach (> not >=)."""
        before = _counter_value(PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="test")
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            5.0,
        )
        record_provider_latency("test", 5.0)
        after = _counter_value(PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="test")
        assert after == before

    def test_zero_threshold_disables_breach_counting(self, monkeypatch):
        """A zero threshold means SLA checking is off; no breaches counted."""
        before = _counter_value(
            PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="openai"
        )
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            0.0,
        )
        record_provider_latency("openai", 999.0)
        after = _counter_value(
            PROVIDER_LATENCY_SLA_BREACHES_TOTAL, provider="openai"
        )
        assert after == before

    def test_breach_emits_warning_log(self, monkeypatch, caplog):
        """A breach must log a warning with provider, latency, and threshold."""
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            1.0,
        )
        with caplog.at_level(logging.WARNING):
            record_provider_latency("openai", 3.5)
        assert "provider_latency_sla_breach" in caplog.text
        assert "openai" in caplog.text
        assert "3.500" in caplog.text

    def test_no_warning_when_within_threshold(self, monkeypatch, caplog):
        """No warning log when latency is within the threshold."""
        monkeypatch.setattr(
            metrics.settings,
            "provider_latency_sla_threshold_seconds",
            10.0,
        )
        with caplog.at_level(logging.WARNING):
            record_provider_latency("groq", 1.0)
        assert "provider_latency_sla_breach" not in caplog.text


class TestHumanitarianVerificationWiresLatency:
    """Integration test: the verification call site records provider latency
    across a real (fixture-driven) request cycle."""

    def test_fixture_provider_records_latency(self):
        """A full verify_claim cycle via the FixtureProvider populates the
        provider_response_latency_seconds histogram for the 'test' provider."""
        from services.humanitarian_verification import HumanitarianVerificationService

        before = _histogram_count(
            PROVIDER_RESPONSE_LATENCY_SECONDS, provider="test"
        )

        with patch("services.providers.settings") as prov_settings, patch(
            "services.humanitarian_verification.settings"
        ) as hv_settings, patch("metrics.settings") as m_settings:
            for mock_settings in (prov_settings, hv_settings, m_settings):
                mock_settings.test_provider_mode = True
                mock_settings.openai_api_key = None
                mock_settings.groq_api_key = None
                mock_settings.openai_model = "gpt-4o-mini"
                mock_settings.groq_model = "llama-3.3-70b-versatile"
                mock_settings.llm_timeout_seconds = 30
                mock_settings.ai_deterministic_mode = False
                mock_settings.circuit_breaker_failure_threshold = 3
                mock_settings.circuit_breaker_recovery_timeout_seconds = 30.0
                mock_settings.llm_provider_fallback_order = "test"
                mock_settings.get_llm_fallback_order.return_value = ["test"]
                mock_settings.get_ocr_fallback_order.return_value = ["test"]
                mock_settings.provider_capability_matrix = {
                    "test": ["llm", "ocr"],
                    "openai": ["llm"],
                    "groq": ["llm"],
                    "tesseract": ["ocr"],
                }
                mock_settings.llm_provider_cost_ceilings = {}
                mock_settings.llm_model_cost_per_1k_tokens = {}
                mock_settings.humanitarian_primary_prompt_version = "v1"
                mock_settings.humanitarian_fallback_prompt_version = "v1"
                mock_settings.provider_latency_sla_threshold_seconds = 10.0

            svc = HumanitarianVerificationService()
            result = svc.verify_claim("Test humanitarian aid claim for unit test")

        after = _histogram_count(
            PROVIDER_RESPONSE_LATENCY_SECONDS, provider="test"
        )

        assert after > before, (
            "Expected provider_response_latency_seconds histogram to be "
            "observed for the 'test' provider after a verify_claim cycle"
        )
        assert result["provider"] == "test"
