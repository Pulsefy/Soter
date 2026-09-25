"""Tests for the synthetic canary health-check service.

Coverage
--------
* Canary probe success records a circuit-breaker success and increments metrics.
* Canary probe failure records a circuit-breaker failure and increments metrics.
* Providers listed in canary_disabled_providers are skipped (outcome=skipped).
* CanaryService._active_providers() respects the disabled set.
* A single _run_round() fans out to all active providers.
* The scheduler loop respects CANARY_ENABLED=false (global kill-switch).
* CanaryService.start() creates a background task; stop() cancels it cleanly.
* The process-wide singleton helpers (get_canary / set_canary) work correctly.
* Canary log records carry the distinguishing ``canary=True`` extra field.
* Canary probes always run regardless of circuit breaker state (open/closed).
"""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.circuit_breaker import CircuitBreaker, CircuitBreakerRegistry, OPEN, CLOSED
from services.canary import (
    CanaryService,
    _probe_provider,
    get_canary,
    set_canary,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_cb_registry():
    CircuitBreakerRegistry._clear_for_tests()
    yield
    CircuitBreakerRegistry._clear_for_tests()


@pytest.fixture(autouse=True)
def reset_canary_singleton():
    """Ensure each test gets a fresh singleton."""
    original = None
    try:
        import services.canary as _mod
        original = _mod._canary
    except Exception:
        pass
    yield
    set_canary(original)


@pytest.fixture()
def fake_provider_registry():
    """Return a ProviderRegistry stub with a controllable llm_chat."""
    provider = MagicMock()
    provider.llm_chat.return_value = MagicMock(model="test-model/fixture")

    registry = MagicMock()
    registry.get.return_value = provider
    registry.available_llm_providers.return_value = ["openai", "groq"]
    return registry, provider


# ---------------------------------------------------------------------------
# _probe_provider unit tests
# ---------------------------------------------------------------------------


class TestProbeProvider:
    def test_success_records_cb_success_and_increments_metric(self, caplog):
        """A successful canary probe records breaker success and emits metrics."""
        breaker = CircuitBreaker(name="openai", failure_threshold=3, recovery_timeout=30.0)
        # Pre-warm with one failure so record_success is observable
        breaker.record_failure()
        assert breaker.failure_count == 1

        fake_response = SimpleNamespace(model="gpt-4o-mini")

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL") as mock_counter,
            patch("metrics.CANARY_LATENCY") as mock_hist,
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.return_value = fake_response
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("openai", "Reply with the single word: ok")

        assert breaker.failure_count == 0  # record_success resets it
        mock_counter.labels.assert_called_with(provider="openai", outcome="success")
        mock_counter.labels.return_value.inc.assert_called_once()
        mock_hist.labels.assert_called_with(provider="openai")

    def test_failure_records_cb_failure_and_increments_metric(self):
        """A failing canary probe records breaker failure and emits metrics."""
        breaker = CircuitBreaker(name="groq", failure_threshold=5, recovery_timeout=30.0)

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL") as mock_counter,
            patch("metrics.CANARY_LATENCY") as mock_hist,
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.side_effect = RuntimeError("connection refused")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("groq", "Reply with the single word: ok")

        assert breaker.failure_count == 1
        mock_counter.labels.assert_called_with(provider="groq", outcome="failure")
        mock_counter.labels.return_value.inc.assert_called_once()

    def test_probe_runs_even_when_breaker_is_open(self):
        """Canary probes run unconditionally, even when the breaker is OPEN."""
        breaker = CircuitBreaker(name="openai", failure_threshold=1, recovery_timeout=9999)
        breaker.record_failure()  # trips to OPEN
        assert breaker.state == OPEN

        fake_response = SimpleNamespace(model="gpt-4o-mini")

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.return_value = fake_response
            mock_reg_cls.return_value.get.return_value = mock_prov

            # Should not raise and should call llm_chat (probe runs through open breaker)
            _probe_provider("openai", "Reply with the single word: ok")

        mock_reg_cls.return_value.get.return_value.llm_chat.assert_called_once()

    def test_creates_breaker_if_none_registered(self):
        """_probe_provider auto-registers a breaker for an unknown provider."""
        assert CircuitBreakerRegistry.get("newprovider") is None

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.return_value = SimpleNamespace(model="m")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("newprovider", "ok?")

        assert CircuitBreakerRegistry.get("newprovider") is not None

    def test_success_log_carries_canary_marker(self, caplog):
        """Successful canary log records must carry canary=True in extras."""
        CircuitBreaker(name="openai", failure_threshold=3, recovery_timeout=30.0)

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
            caplog.at_level(logging.INFO, logger="services.canary"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.return_value = SimpleNamespace(model="gpt-4o-mini")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("openai", "Reply with the single word: ok")

        # At least one log record should mention [canary] in its message
        canary_records = [r for r in caplog.records if "[canary]" in r.getMessage()]
        assert canary_records, "Expected a '[canary]' log record"
        # The extra field must be set on the record
        assert any(getattr(r, "canary", False) for r in canary_records)

    def test_failure_log_carries_canary_marker(self, caplog):
        """Failing canary log records must carry canary=True in extras."""
        CircuitBreaker(name="groq", failure_threshold=3, recovery_timeout=30.0)

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
            caplog.at_level(logging.WARNING, logger="services.canary"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.side_effect = RuntimeError("timeout")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("groq", "Reply with the single word: ok")

        canary_records = [r for r in caplog.records if "[canary]" in r.getMessage()]
        assert canary_records
        assert any(getattr(r, "canary", False) for r in canary_records)


# ---------------------------------------------------------------------------
# CanaryService unit tests
# ---------------------------------------------------------------------------


class TestCanaryServiceActiveProviders:
    def test_returns_all_available_when_none_disabled(self):
        svc = CanaryService(disabled_providers=set())

        with patch("services.canary.ProviderRegistry") as mock_reg_cls, \
             patch("metrics.CANARY_CHECKS_TOTAL"):
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]
            result = svc._active_providers()

        assert result == ["openai", "groq"]

    def test_excludes_disabled_providers(self):
        svc = CanaryService(disabled_providers={"openai"})

        with patch("services.canary.ProviderRegistry") as mock_reg_cls, \
             patch("metrics.CANARY_CHECKS_TOTAL"):
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]
            result = svc._active_providers()

        assert result == ["groq"]
        assert "openai" not in result

    def test_skipped_provider_increments_skipped_metric(self):
        svc = CanaryService(disabled_providers={"openai"})

        with patch("services.canary.ProviderRegistry") as mock_reg_cls, \
             patch("metrics.CANARY_CHECKS_TOTAL") as mock_counter:
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]
            svc._active_providers()

        mock_counter.labels.assert_any_call(provider="openai", outcome="skipped")

    def test_all_disabled_returns_empty(self):
        svc = CanaryService(disabled_providers={"openai", "groq"})

        with patch("services.canary.ProviderRegistry") as mock_reg_cls, \
             patch("metrics.CANARY_CHECKS_TOTAL"):
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]
            result = svc._active_providers()

        assert result == []

    def test_reads_disabled_from_settings_when_not_overridden(self):
        """Without constructor override, disabled list comes from settings."""
        svc = CanaryService()  # no disabled_providers kwarg

        with (
            patch("services.canary.settings") as mock_settings,
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
        ):
            mock_settings.get_canary_disabled_providers.return_value = ["groq"]
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]
            result = svc._active_providers()

        assert result == ["openai"]


class TestCanaryServiceRunRound:
    @pytest.mark.asyncio
    async def test_run_round_calls_probe_for_each_provider(self):
        svc = CanaryService(interval_seconds=999, disabled_providers=set(), prompt="ok?")

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("services.canary._probe_provider") as mock_probe,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("services.canary.settings") as mock_settings,
        ):
            mock_settings.canary_enabled = True
            mock_settings.get_canary_disabled_providers.return_value = []
            mock_reg_cls.return_value.available_llm_providers.return_value = ["openai", "groq"]

            await svc._run_round()

        assert mock_probe.call_count == 2
        called_providers = {call.args[0] for call in mock_probe.call_args_list}
        assert called_providers == {"openai", "groq"}

    @pytest.mark.asyncio
    async def test_run_round_noop_when_globally_disabled(self):
        """When CANARY_ENABLED is false and no constructor override, round is skipped."""
        svc = CanaryService(interval_seconds=999)  # no disabled_providers override

        with (
            patch("services.canary._probe_provider") as mock_probe,
            patch("services.canary.settings") as mock_settings,
        ):
            mock_settings.canary_enabled = False

            await svc._run_round()

        mock_probe.assert_not_called()

    @pytest.mark.asyncio
    async def test_run_round_noop_when_no_providers(self):
        svc = CanaryService(interval_seconds=999, disabled_providers=set())

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("services.canary._probe_provider") as mock_probe,
            patch("services.canary.settings") as mock_settings,
        ):
            mock_settings.canary_enabled = True
            mock_settings.get_canary_disabled_providers.return_value = []
            mock_reg_cls.return_value.available_llm_providers.return_value = []

            await svc._run_round()

        mock_probe.assert_not_called()


class TestCanaryServiceLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_background_task(self):
        svc = CanaryService(interval_seconds=9999, disabled_providers=set())

        with patch.object(svc, "_run_round", new_callable=AsyncMock):
            task = svc.start()
            assert task is svc._task
            assert not task.done()
            await svc.stop()

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self):
        svc = CanaryService(interval_seconds=9999, disabled_providers=set())

        with patch.object(svc, "_run_round", new_callable=AsyncMock):
            svc.start()
            assert not svc._task.done()
            await svc.stop()
            assert svc._task.done()

    @pytest.mark.asyncio
    async def test_stop_is_idempotent_when_not_started(self):
        svc = CanaryService(interval_seconds=9999, disabled_providers=set())
        # Should not raise
        await svc.stop()

    def test_start_raises_if_already_running(self):
        svc = CanaryService(interval_seconds=9999, disabled_providers=set())
        loop = asyncio.new_event_loop()

        async def _run():
            with patch.object(svc, "_run_round", new_callable=AsyncMock):
                svc.start()
                with pytest.raises(RuntimeError, match="already running"):
                    svc.start()
                await svc.stop()

        try:
            loop.run_until_complete(_run())
        finally:
            loop.close()

    @pytest.mark.asyncio
    async def test_loop_calls_run_round_after_interval(self):
        """The loop sleeps for the interval, then calls _run_round."""
        svc = CanaryService(interval_seconds=0.01, disabled_providers=set())

        call_count = 0

        async def fake_run_round():
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                await asyncio.sleep(9999)  # stall so the task can be cancelled

        with patch.object(svc, "_run_round", side_effect=fake_run_round):
            task = svc.start()
            await asyncio.sleep(0.05)  # enough time for ≥2 ticks
            await svc.stop()

        assert call_count >= 2


# ---------------------------------------------------------------------------
# Singleton helpers
# ---------------------------------------------------------------------------


class TestSingleton:
    def test_get_canary_returns_same_instance(self):
        set_canary(None)
        first = get_canary()
        second = get_canary()
        assert first is second

    def test_set_canary_overrides_singleton(self):
        custom = CanaryService(interval_seconds=1)
        set_canary(custom)
        assert get_canary() is custom

    def test_set_canary_none_clears_so_next_get_builds_fresh(self):
        set_canary(None)
        result = get_canary()
        assert result is not None


# ---------------------------------------------------------------------------
# Settings integration
# ---------------------------------------------------------------------------


class TestCanarySettings:
    def test_interval_read_from_settings_when_not_overridden(self):
        svc = CanaryService()

        with patch("services.canary.settings") as mock_settings:
            mock_settings.canary_interval_seconds = 120.0
            assert svc._effective_interval() == 120.0

    def test_constructor_interval_overrides_settings(self):
        svc = CanaryService(interval_seconds=42.0)

        with patch("services.canary.settings") as mock_settings:
            mock_settings.canary_interval_seconds = 120.0
            assert svc._effective_interval() == 42.0

    def test_prompt_read_from_settings_when_not_overridden(self):
        svc = CanaryService()

        with patch("services.canary.settings") as mock_settings:
            mock_settings.canary_prompt = "ping"
            assert svc._effective_prompt() == "ping"

    def test_constructor_prompt_overrides_settings(self):
        svc = CanaryService(prompt="custom prompt")

        with patch("services.canary.settings") as mock_settings:
            mock_settings.canary_prompt = "other"
            assert svc._effective_prompt() == "custom prompt"


# ---------------------------------------------------------------------------
# Circuit breaker trip via canary (end-to-end within the module)
# ---------------------------------------------------------------------------


class TestCanaryTripsBreaker:
    def test_repeated_canary_failures_trip_circuit_breaker(self):
        """Three canary failures on a threshold-3 breaker should open it."""
        breaker = CircuitBreaker(name="openai", failure_threshold=3, recovery_timeout=30.0)

        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.side_effect = RuntimeError("upstream 503")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("openai", "ok?")
            _probe_provider("openai", "ok?")
            _probe_provider("openai", "ok?")

        assert breaker.state == OPEN

    def test_canary_success_closes_open_breaker_via_half_open(self):
        """A canary success after recovery timeout transitions the breaker back to CLOSED."""
        import time as _time

        with patch("services.circuit_breaker.time.time") as mock_time:
            mock_time.return_value = 1000.0
            breaker = CircuitBreaker(name="groq", failure_threshold=1, recovery_timeout=30.0)
            breaker.record_failure()
            assert breaker.state == OPEN

            # Advance past recovery timeout so allow_request flips to HALF_OPEN
            mock_time.return_value = 1031.0
            breaker.allow_request()  # triggers HALF_OPEN
            assert breaker.state == "HALF_OPEN"

        # Now a canary success should close it
        with (
            patch("services.canary.ProviderRegistry") as mock_reg_cls,
            patch("metrics.CANARY_CHECKS_TOTAL"),
            patch("metrics.CANARY_LATENCY"),
        ):
            mock_prov = MagicMock()
            mock_prov.llm_chat.return_value = SimpleNamespace(model="llama")
            mock_reg_cls.return_value.get.return_value = mock_prov

            _probe_provider("groq", "ok?")

        assert breaker.state == CLOSED
