"""Tests for provider health registry (Issue #770).

Coverage
--------
* ProviderHealthRegistry: record_failure, record_success, get_health,
  all_health, overall_status, clear.
* ProviderHealthRecord: to_dict public vs private.
* Circuit-breaker integration: OPEN -> DOWN, HALF_OPEN -> DEGRADED.
* Rolling window: events older than 1h are excluded from error-rate.
* Thread safety: concurrent record_failure calls do not corrupt state.
"""

import time
import threading
from unittest.mock import MagicMock

import pytest

from services.provider_health import (
    ProviderHealthRegistry,
    ProviderHealthRecord,
    ProviderStatus,
    provider_health_registry,
    _FailureEvent,
)
from services.circuit_breaker import CircuitBreaker


@pytest.fixture(autouse=True)
def clear_registry():
    provider_health_registry.clear()
    yield
    provider_health_registry.clear()


@pytest.fixture
def fresh_registry():
    reg = ProviderHealthRegistry()
    reg.clear()
    yield reg
    reg.clear()


class TestProviderStatus:
    def test_status_values(self):
        assert ProviderStatus.HEALTHY.value == "healthy"
        assert ProviderStatus.DEGRADED.value == "degraded"
        assert ProviderStatus.DOWN.value == "down"


class TestProviderHealthRecord:
    def test_public_dict_omits_internals(self):
        record = ProviderHealthRecord(
            name="openai",
            status=ProviderStatus.HEALTHY,
            circuit_state="CLOSED",
            failure_count=0,
            failure_threshold=3,
        )
        public = record.to_dict(public=True)
        assert "name" in public
        assert "status" in public
        assert "circuit_state" in public
        assert "failure_count" not in public
        assert "error_rate" not in public

    def test_private_dict_includes_internals(self):
        record = ProviderHealthRecord(
            name="openai",
            status=ProviderStatus.DEGRADED,
            circuit_state="CLOSED",
            failure_count=2,
            failure_threshold=3,
            consecutive_failures=2,
            error_rate=0.5,
        )
        private = record.to_dict(public=False)
        assert private["failure_count"] == 2
        assert private["consecutive_failures"] == 2
        assert private["error_rate"] == 0.5


class TestRecordFailure:
    def test_single_failure(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai", error_code="AI_TIMEOUT")
        health = reg.get_health("openai")
        assert health.consecutive_failures == 1
        assert health.total_failures_1h == 1
        assert health.last_failure_at is not None

    def test_multiple_failures_increment_consecutive(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.record_failure("openai")
        reg.record_failure("openai")
        health = reg.get_health("openai")
        assert health.consecutive_failures == 3
        assert health.total_failures_1h == 3

    def test_success_resets_consecutive(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.record_failure("openai")
        reg.record_success("openai")
        health = reg.get_health("openai")
        assert health.consecutive_failures == 0
        assert health.last_success_at is not None

    def test_failure_after_success_increments_from_zero(self, fresh_registry):
        reg = fresh_registry
        reg.record_success("openai")
        reg.record_failure("openai")
        health = reg.get_health("openai")
        assert health.consecutive_failures == 1

    def test_different_providers_isolated(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.record_failure("groq")
        assert reg.get_health("openai").consecutive_failures == 1
        assert reg.get_health("groq").consecutive_failures == 1


class TestCircuitBreakerIntegration:
    def test_open_circuit_marks_down(self, fresh_registry):
        reg = fresh_registry
        cb = CircuitBreaker("openai", failure_threshold=2, recovery_timeout=60.0)
        cb.record_failure()
        cb.record_failure()
        health = reg.get_health("openai", circuit_breaker=cb)
        assert health.status == ProviderStatus.DOWN
        assert health.circuit_state == "OPEN"

    def test_half_open_marks_degraded(self, fresh_registry):
        reg = fresh_registry
        cb = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=0.01)
        cb.record_failure()
        time.sleep(0.02)
        cb.allow_request()
        health = reg.get_health("openai", circuit_breaker=cb)
        assert health.status == ProviderStatus.DEGRADED
        assert health.circuit_state == "HALF_OPEN"

    def test_closed_with_high_consecutive_marks_degraded(self, fresh_registry):
        reg = fresh_registry
        cb = CircuitBreaker("openai", failure_threshold=5, recovery_timeout=60.0)
        reg.record_failure("openai")
        reg.record_failure("openai")
        health = reg.get_health("openai", circuit_breaker=cb)
        assert health.status == ProviderStatus.DEGRADED
        assert health.circuit_state == "CLOSED"

    def test_success_in_half_open_closes_and_marks_healthy(self, fresh_registry):
        reg = fresh_registry
        cb = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=0.01)
        cb.record_failure()
        time.sleep(0.02)
        cb.allow_request()
        cb.record_success()
        health = reg.get_health("openai", circuit_breaker=cb)
        assert health.status == ProviderStatus.HEALTHY
        assert health.circuit_state == "CLOSED"


class TestErrorRateCalculation:
    def test_zero_events_zero_error_rate(self, fresh_registry):
        reg = fresh_registry
        health = reg.get_health("openai")
        assert health.error_rate == 0.0

    def test_only_failures_error_rate_one(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        health = reg.get_health("openai")
        assert health.error_rate == 1.0

    def test_success_reduces_error_rate(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.record_failure("openai")
        reg.record_success("openai")
        health = reg.get_health("openai")
        assert health.error_rate == pytest.approx(2 / 3, abs=0.01)

    def test_high_error_rate_marks_degraded(self, fresh_registry):
        reg = fresh_registry
        cb = CircuitBreaker("openai", failure_threshold=10, recovery_timeout=60.0)
        for _ in range(4):
            reg.record_failure("openai")
        reg.record_success("openai")
        health = reg.get_health("openai", circuit_breaker=cb)
        assert health.error_rate >= 0.25
        assert health.status == ProviderStatus.DEGRADED


class TestOverallStatus:
    def test_all_healthy(self, fresh_registry):
        reg = fresh_registry
        reg.record_success("openai")
        reg.record_success("groq")
        cbs = {
            "openai": CircuitBreaker("openai"),
            "groq": CircuitBreaker("groq"),
        }
        assert reg.overall_status(cbs) == ProviderStatus.HEALTHY

    def test_one_down_one_healthy_is_degraded(self, fresh_registry):
        reg = fresh_registry
        reg.record_success("groq")
        cb_openai = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=60.0)
        cb_openai.record_failure()
        cbs = {"openai": cb_openai, "groq": CircuitBreaker("groq")}
        assert reg.overall_status(cbs) == ProviderStatus.DEGRADED

    def test_all_down_is_down(self, fresh_registry):
        reg = fresh_registry
        cb1 = CircuitBreaker("openai", failure_threshold=1, recovery_timeout=60.0)
        cb1.record_failure()
        cb2 = CircuitBreaker("groq", failure_threshold=1, recovery_timeout=60.0)
        cb2.record_failure()
        cbs = {"openai": cb1, "groq": cb2}
        assert reg.overall_status(cbs) == ProviderStatus.DOWN

    def test_empty_registry_is_healthy(self, fresh_registry):
        assert fresh_registry.overall_status() == ProviderStatus.HEALTHY


class TestRollingWindow:
    def test_old_events_trimmed(self, fresh_registry, monkeypatch):
        reg = fresh_registry
        now = time.time()
        reg._ensure_queue("openai")
        reg._events["openai"].append(_FailureEvent(timestamp=now - 7200, provider="openai"))
        reg._events["openai"].append(_FailureEvent(timestamp=now, provider="openai"))
        health = reg.get_health("openai")
        assert health.total_failures_1h == 1

    def test_events_beyond_maxlen_dropped(self, fresh_registry):
        reg = fresh_registry
        reg.MAX_EVENTS_PER_PROVIDER = 5
        for _ in range(10):
            reg.record_failure("openai")
        assert len(reg._events["openai"]) == 5


class TestClear:
    def test_clear_single_provider(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.clear("openai")
        health = reg.get_health("openai")
        assert health.total_failures_1h == 0
        assert health.consecutive_failures == 0

    def test_clear_all(self, fresh_registry):
        reg = fresh_registry
        reg.record_failure("openai")
        reg.record_failure("groq")
        reg.clear()
        assert reg.get_health("openai").total_failures_1h == 0
        assert reg.get_health("groq").total_failures_1h == 0


class TestThreadSafety:
    def test_concurrent_record_failure(self, fresh_registry):
        reg = fresh_registry
        errors = []

        def worker():
            try:
                for _ in range(100):
                    reg.record_failure("openai")
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        health = reg.get_health("openai")
        assert health.total_failures_1h == 500
        assert health.consecutive_failures == 500

    def test_concurrent_mixed_operations(self, fresh_registry):
        reg = fresh_registry
        errors = []

        def fail_worker():
            try:
                for _ in range(50):
                    reg.record_failure("openai")
            except Exception as exc:
                errors.append(exc)

        def success_worker():
            try:
                for _ in range(50):
                    reg.record_success("openai")
            except Exception as exc:
                errors.append(exc)

        threads = []
        for _ in range(3):
            threads.append(threading.Thread(target=fail_worker))
            threads.append(threading.Thread(target=success_worker))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        health = reg.get_health("openai")
        assert health.total_failures_1h == 150
        assert health.total_failures_1h + health.total_successes_1h == 300


class TestModuleSingleton:
    def test_singleton_exists(self):
        from services.provider_health import provider_health_registry as singleton
        assert isinstance(singleton, ProviderHealthRegistry)