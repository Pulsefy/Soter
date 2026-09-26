import logging
from unittest.mock import patch

import pytest

from services.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerRegistry,
    CLOSED,
    OPEN,
    HALF_OPEN,
)


@pytest.fixture(autouse=True)
def clear_registry():
    CircuitBreakerRegistry._clear_for_tests()
    yield
    CircuitBreakerRegistry._clear_for_tests()


def make_breaker(**kwargs):
    defaults = dict(name="test-provider", failure_threshold=3, recovery_timeout=30.0)
    defaults.update(kwargs)
    return CircuitBreaker(**defaults)


class TestStateTransitions:
    def test_starts_closed(self):
        cb = make_breaker()
        assert cb.state == CLOSED
        assert cb.allow_request() is True

    def test_stays_closed_below_threshold(self):
        cb = make_breaker(failure_threshold=3)
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CLOSED
        assert cb.allow_request() is True

    def test_opens_at_failure_threshold(self, caplog):
        cb = make_breaker(failure_threshold=3)
        with caplog.at_level(logging.WARNING):
            cb.record_failure()
            cb.record_failure()
            cb.record_failure()
        assert cb.state == OPEN
        assert cb.allow_request() is False
        assert "failure_threshold_reached" in caplog.text

    def test_success_resets_failure_count_while_closed(self):
        cb = make_breaker(failure_threshold=3)
        cb.record_failure()
        cb.record_failure()
        cb.record_success()
        assert cb.failure_count == 0
        cb.record_failure()
        cb.record_failure()
        assert cb.state == CLOSED  # count was reset, so 2 failures isn't enough

    @patch("services.circuit_breaker.time.time")
    def test_transitions_to_half_open_after_recovery_timeout(self, mock_time):
        mock_time.return_value = 1000.0
        cb = make_breaker(failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()
        assert cb.state == OPEN

        mock_time.return_value = 1000.0 + 10  # not enough time elapsed
        assert cb.allow_request() is False
        assert cb.state == OPEN

        mock_time.return_value = 1000.0 + 30  # timeout fully elapsed
        assert cb.allow_request() is True
        assert cb.state == HALF_OPEN

    @patch("services.circuit_breaker.time.time")
    def test_half_open_success_closes_circuit(self, mock_time):
        mock_time.return_value = 1000.0
        cb = make_breaker(failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()
        mock_time.return_value = 1030.0
        cb.allow_request()  # -> HALF_OPEN
        assert cb.state == HALF_OPEN

        cb.record_success()
        assert cb.state == CLOSED
        assert cb.failure_count == 0

    @patch("services.circuit_breaker.time.time")
    def test_half_open_failure_reopens_circuit(self, mock_time):
        mock_time.return_value = 1000.0
        cb = make_breaker(failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()
        mock_time.return_value = 1030.0
        cb.allow_request()  # -> HALF_OPEN
        assert cb.state == HALF_OPEN

        cb.record_failure()
        assert cb.state == OPEN

    def test_transition_logs_include_reason_and_provider(self, caplog):
        cb = make_breaker(name="stripe", failure_threshold=1)
        with caplog.at_level(logging.WARNING):
            cb.record_failure()
        record = caplog.records[-1]
        assert record.provider == "stripe"
        assert record.to_state == OPEN
        assert record.reason  # some non-empty reason string was attached


class TestTimeUntilRetry:
    def test_zero_when_closed(self):
        cb = make_breaker()
        assert cb.time_until_retry() == 0.0

    @patch("services.circuit_breaker.time.time")
    def test_counts_down_while_open(self, mock_time):
        mock_time.return_value = 1000.0
        cb = make_breaker(failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()
        assert cb.time_until_retry() == 30.0

        mock_time.return_value = 1000.0 + 10
        assert cb.time_until_retry() == pytest.approx(20.0)

        mock_time.return_value = 1000.0 + 45  # elapsed past the timeout
        assert cb.time_until_retry() == 0.0

    @patch("services.circuit_breaker.time.time")
    def test_zero_immediately_after_manual_reset(self, mock_time):
        mock_time.return_value = 1000.0
        cb = make_breaker(failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()
        assert cb.time_until_retry() == 30.0

        cb.reset()
        assert cb.state == CLOSED
        assert cb.time_until_retry() == 0.0


class TestManualReset:
    def test_reset_forces_closed_even_mid_timeout(self):
        cb = make_breaker(failure_threshold=1, recovery_timeout=9999)
        cb.record_failure()
        assert cb.state == OPEN

        cb.reset(reason="operator_override")
        assert cb.state == CLOSED
        assert cb.failure_count == 0
        assert cb.allow_request() is True

    def test_reset_logs_reason(self, caplog):
        cb = make_breaker(failure_threshold=1)
        cb.record_failure()
        with caplog.at_level(logging.INFO):
            cb.reset(reason="operator_override")
        assert "operator_override" in caplog.text


class TestRegistry:
    def test_registers_on_creation(self):
        cb = make_breaker(name="paypal")
        assert CircuitBreakerRegistry.get("paypal") is cb

    def test_unconfigured_provider_returns_none(self):
        # Distinguishes "never configured" from "circuit open" per the
        # ticket's motivating incident scenario.
        assert CircuitBreakerRegistry.get("never-configured-provider") is None

    def test_all_states_reports_every_registered_provider(self):
        make_breaker(name="stripe")
        make_breaker(name="paypal")
        states = CircuitBreakerRegistry.all_states()
        assert set(states.keys()) == {"stripe", "paypal"}
        assert states["stripe"]["state"] == CLOSED

    def test_registry_reset_updates_breaker(self):
        cb = make_breaker(name="stripe", failure_threshold=1)
        cb.record_failure()
        assert cb.state == OPEN

        result = CircuitBreakerRegistry.reset("stripe", reason="via_admin_api")
        assert result["state"] == CLOSED
        assert cb.state == CLOSED

    def test_registry_reset_unknown_provider_raises(self):
        with pytest.raises(KeyError):
            CircuitBreakerRegistry.reset("does-not-exist")
