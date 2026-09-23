"""
Tests for circuit-breaker alerting (issue #1205).

Coverage
--------
* Alert dispatch on the two operator-actionable transitions: to ``OPEN``
  (provider outage, carrying provider/timestamp/failure count) and back to
  ``CLOSED`` (recovery).
* Half-open probes and no-op transitions are never alerted.
* De-duplication collapses repeated open/close flapping within the configured
  window while still delivering the first open and the first recovery.
* HMAC-SHA256 signing of the alert body via the shared ``X-Signature-256``
  header scheme.
* Alerting is disabled when no webhook URL is configured; delivery failures are
  logged and counted but never raised.
* Payload wire format (camelCase) and settings construction.
"""

import hashlib
import hmac
import json
import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerRegistry,
    CLOSED,
    OPEN,
    HALF_OPEN,
)
import services.circuit_breaker_alerts as alerts
from services.circuit_breaker_alerts import (
    ALERT_EVENT_OPENED,
    ALERT_EVENT_RECOVERED,
    SIGNATURE_HEADER,
    CircuitBreakerAlerter,
    CircuitBreakerAlertPayload,
    build_alerter_from_settings,
    event_for_transition,
    notify_breaker_transition,
)

_ALERT_URL = "http://alerts.test/circuit-breaker"
_SECRET = "test-alert-secret-32-chars-long!!"


@pytest.fixture(autouse=True)
def clear_registry():
    CircuitBreakerRegistry._clear_for_tests()
    yield
    CircuitBreakerRegistry._clear_for_tests()


@pytest.fixture(autouse=True)
def reset_alerter():
    alerts.reset_alerter_for_tests()
    yield
    alerts.reset_alerter_for_tests()


class FakeClock:
    """Deterministic clock so de-duplication windows are testable."""

    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_alerter(clock=None, secret=_SECRET, dedup_window_seconds=300.0):
    """Build a synchronous (non-threaded) alerter that records deliveries."""
    delivered = []

    def deliver(url, body, headers):
        delivered.append((url, body, headers))

    alerter = CircuitBreakerAlerter(
        webhook_url=_ALERT_URL,
        secret=secret,
        dedup_window_seconds=dedup_window_seconds,
        background=False,
        time_fn=clock or FakeClock(),
        deliver_fn=deliver,
    )
    return alerter, delivered


def _events(delivered):
    return [json.loads(body)["event"] for _, body, _ in delivered]


class TestTransitionEvents:
    @pytest.mark.parametrize(
        "from_state,to_state,expected",
        [
            (CLOSED, OPEN, ALERT_EVENT_OPENED),
            (HALF_OPEN, OPEN, ALERT_EVENT_OPENED),
            (OPEN, CLOSED, ALERT_EVENT_RECOVERED),
            (HALF_OPEN, CLOSED, ALERT_EVENT_RECOVERED),
            (CLOSED, HALF_OPEN, None),
            (CLOSED, CLOSED, None),
            (OPEN, OPEN, None),
        ],
    )
    def test_event_mapping(self, from_state, to_state, expected):
        assert event_for_transition(from_state, to_state) == expected


class TestAlertContent:
    def test_opening_emits_alert_with_provider_time_and_failure_count(self):
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=2)
        cb.record_failure()
        assert delivered == []  # below threshold: nothing to alert yet

        cb.record_failure()
        assert len(delivered) == 1

        url, body, headers = delivered[0]
        payload = json.loads(body)
        assert url == _ALERT_URL
        assert payload["alertType"] == "circuit_breaker"
        assert payload["event"] == ALERT_EVENT_OPENED
        assert payload["provider"] == "openai"
        assert payload["fromState"] == CLOSED
        assert payload["toState"] == OPEN
        assert payload["failureCount"] == 2
        assert payload["reason"]
        assert payload["timestamp"].endswith("Z")
        assert payload["service"] == "soter-ai-service"
        assert headers["Content-Type"] == "application/json"

    @patch("services.circuit_breaker.time.time")
    def test_recovery_via_successful_probe_emits_alert(self, mock_time):
        mock_time.return_value = 1000.0
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="groq", failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()  # -> OPEN
        mock_time.return_value = 1030.0
        cb.allow_request()  # -> HALF_OPEN (not alerted)
        cb.record_success()  # -> CLOSED (recovery alerted)

        assert _events(delivered) == [ALERT_EVENT_OPENED, ALERT_EVENT_RECOVERED]

    def test_manual_reset_from_open_emits_recovery_alert(self):
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="test", failure_threshold=1)
        cb.record_failure()
        cb.reset(reason="operator_override")

        recovered = json.loads(delivered[-1][1])
        assert recovered["event"] == ALERT_EVENT_RECOVERED
        assert recovered["fromState"] == OPEN
        assert recovered["toState"] == CLOSED
        assert recovered["reason"] == "operator_override"

    @patch("services.circuit_breaker.time.time")
    def test_half_open_probe_is_not_alerted(self, mock_time):
        mock_time.return_value = 1000.0
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()  # -> OPEN
        mock_time.return_value = 1030.0
        cb.allow_request()  # -> HALF_OPEN

        assert len(delivered) == 1  # only the open alert

    @patch("services.circuit_breaker.time.time")
    def test_failed_half_open_probe_reopens_and_alerts(self, mock_time):
        mock_time.return_value = 1000.0
        clock = FakeClock()
        alerter, delivered = make_alerter(clock=clock)
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=1, recovery_timeout=30.0)
        cb.record_failure()  # -> OPEN
        mock_time.return_value = 1030.0
        cb.allow_request()  # -> HALF_OPEN
        clock.advance(301)  # move the alerter past its dedup window
        cb.record_failure()  # -> OPEN again

        assert _events(delivered) == [ALERT_EVENT_OPENED, ALERT_EVENT_OPENED]


class TestDeduplication:
    def test_flapping_within_window_is_collapsed(self):
        clock = FakeClock()
        alerter, delivered = make_alerter(clock=clock)
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=1)
        cb.record_failure()  # opened -> sent
        cb.reset()  # recovered -> sent
        cb.record_failure()  # opened again, inside window -> suppressed
        cb.reset()  # recovered again, inside window -> suppressed
        cb.record_failure()  # suppressed

        assert _events(delivered) == [ALERT_EVENT_OPENED, ALERT_EVENT_RECOVERED]
        assert alerter.sent_count == 2
        assert alerter.suppressed_count == 3

    def test_alert_allowed_once_window_elapses(self):
        clock = FakeClock()
        alerter, delivered = make_alerter(clock=clock)
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=1)
        cb.record_failure()  # opened
        cb.reset()  # recovered
        clock.advance(301)  # past the 300s window
        cb.record_failure()  # opened again -> sent

        assert _events(delivered) == [
            ALERT_EVENT_OPENED,
            ALERT_EVENT_RECOVERED,
            ALERT_EVENT_OPENED,
        ]
        assert alerter.suppressed_count == 0

    def test_zero_window_disables_deduplication(self):
        alerter, delivered = make_alerter(dedup_window_seconds=0.0)
        alerts.set_alerter(alerter)

        cb = CircuitBreaker(name="openai", failure_threshold=1)
        cb.record_failure()
        cb.reset()
        cb.record_failure()

        assert len(delivered) == 3
        assert alerter.suppressed_count == 0

    def test_dedup_is_per_provider(self):
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        CircuitBreaker(name="openai", failure_threshold=1).record_failure()
        CircuitBreaker(name="groq", failure_threshold=1).record_failure()

        assert len(delivered) == 2  # each provider alerts independently


class TestSigning:
    def test_alert_body_is_hmac_sha256_signed(self):
        alerter, delivered = make_alerter()
        alerts.set_alerter(alerter)

        CircuitBreaker(name="openai", failure_threshold=1).record_failure()

        _, body, headers = delivered[0]
        expected = hmac.new(_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
        assert headers[SIGNATURE_HEADER] == expected

    def test_unsigned_when_no_secret_configured(self):
        alerter, delivered = make_alerter(secret=None)
        alerts.set_alerter(alerter)

        CircuitBreaker(name="openai", failure_threshold=1).record_failure()

        _, _, headers = delivered[0]
        assert SIGNATURE_HEADER not in headers


class TestDisabledAndFailures:
    def test_no_alert_when_webhook_not_configured(self):
        # The default settings ship no alert URL, so a transition is a no-op.
        assert notify_breaker_transition("openai", CLOSED, OPEN, 3) is False

    def test_build_alerter_returns_none_when_disabled(self):
        source = SimpleNamespace(
            circuit_breaker_alerts_enabled=False,
            circuit_breaker_alert_webhook_url=_ALERT_URL,
            ai_webhook_secret=_SECRET,
            circuit_breaker_alert_dedup_seconds=300.0,
        )
        assert build_alerter_from_settings(source) is None

    def test_build_alerter_returns_none_without_url(self):
        source = SimpleNamespace(
            circuit_breaker_alerts_enabled=True,
            circuit_breaker_alert_webhook_url=None,
            ai_webhook_secret=_SECRET,
            circuit_breaker_alert_dedup_seconds=300.0,
        )
        assert build_alerter_from_settings(source) is None

    def test_build_alerter_from_settings_wires_values(self):
        source = SimpleNamespace(
            circuit_breaker_alerts_enabled=True,
            circuit_breaker_alert_webhook_url=_ALERT_URL,
            ai_webhook_secret=_SECRET,
            circuit_breaker_alert_dedup_seconds=42.0,
        )
        alerter = build_alerter_from_settings(source)

        assert isinstance(alerter, CircuitBreakerAlerter)
        assert alerter.enabled is True
        assert alerter._dedup_window == 42.0
        assert alerter._secret == _SECRET

    def test_delivery_failure_is_logged_and_counted_not_raised(self, caplog):
        def boom(url, body, headers):
            raise RuntimeError("sink down")

        alerter = CircuitBreakerAlerter(
            webhook_url=_ALERT_URL, background=False, deliver_fn=boom
        )
        with caplog.at_level(logging.ERROR):
            dispatched = alerter.notify_transition("openai", CLOSED, OPEN, 3, "x")

        assert dispatched is True
        assert alerter.failed_count == 1
        assert alerter.sent_count == 0
        assert "circuit_breaker_alert_delivery_failed" in caplog.text

    def test_background_dispatch_spawns_daemon_thread(self, monkeypatch):
        captured = {}

        class ImmediateThread:
            def __init__(self, target=None, args=(), daemon=None):
                self._target = target
                self._args = args
                captured["daemon"] = daemon

            def start(self):
                captured["started"] = True
                self._target(*self._args)

        monkeypatch.setattr(alerts.threading, "Thread", ImmediateThread)

        delivered = []
        alerter = CircuitBreakerAlerter(
            webhook_url=_ALERT_URL,
            background=True,
            deliver_fn=lambda url, body, headers: delivered.append(body),
        )
        assert alerter.notify_transition("openai", CLOSED, OPEN, 1) is True

        assert delivered  # thread body ran
        assert captured["started"] is True
        assert captured["daemon"] is True


class TestPayload:
    def test_serialises_to_camel_case_wire_format(self):
        payload = CircuitBreakerAlertPayload(
            event=ALERT_EVENT_OPENED,
            provider="openai",
            from_state=CLOSED,
            to_state=OPEN,
            failure_count=3,
            reason="failure_threshold_reached:3/3",
            timestamp="2026-09-23T10:30:00Z",
        )
        data = json.loads(payload.to_json_bytes())

        assert data["alertType"] == "circuit_breaker"
        assert data["schemaVersion"] == "1.0"
        assert data["fromState"] == CLOSED
        assert data["toState"] == OPEN
        assert data["failureCount"] == 3
