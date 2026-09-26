"""Circuit-breaker alert notifications (issue #1205).

The AI service already exposes an admin endpoint to *query* and *reset*
circuit breaker state, but nothing told an operator when a breaker actually
opened. This module closes that gap: :class:`~services.circuit_breaker.
CircuitBreaker` calls :func:`notify_breaker_transition` on every state change,
and the transition is forwarded to a documented webhook when it is one of the
two operator-actionable events:

``opened``
    The breaker tripped to ``OPEN`` because a provider kept failing. The alert
    names the provider, the failure count that triggered it, and when.
``recovered``
    The breaker made it back to ``CLOSED`` (a half-open probe succeeded or an
    operator reset it), so the provider is serving traffic again.

``CLOSED -> HALF_OPEN`` probes are intentionally *not* alerted: the breaker is
already resolving itself, which is not operator-actionable.

De-duplication
--------------
A provider that flaps (open, close, open, close, ...) must not spam the
channel. Alerts are keyed by ``(provider, event)`` and a repeat inside
``CIRCUIT_BREAKER_ALERT_DEDUP_SECONDS`` is suppressed. Keying per event means
the first open *and* the first recovery are still delivered even when they
happen close together; only the repeats are collapsed.

Delivery
--------
Delivery is best-effort and asynchronous so it can never block (or crash) the
request that observed the failure. Failures are logged and counted, never
raised. The body is HMAC-SHA256 signed with the shared ``AI_WEBHOOK_SECRET``
and sent in the ``X-Signature-256`` header, matching the existing task-callback
webhook contract (see ``schemas/callback.py``).

Configuration (see ``CIRCUIT_BREAKER_ALERTS.md`` for the full reference):
``CIRCUIT_BREAKER_ALERTS_ENABLED``, ``CIRCUIT_BREAKER_ALERT_WEBHOOK_URL``,
``CIRCUIT_BREAKER_ALERT_DEDUP_SECONDS``, and ``AI_WEBHOOK_SECRET``.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Dict, Optional, Tuple

import httpx
from pydantic import BaseModel, Field

from config import settings

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "1.0"

#: Transition to OPEN — a provider outage an operator should act on.
ALERT_EVENT_OPENED = "opened"
#: Transition back to CLOSED — the provider is healthy again.
ALERT_EVENT_RECOVERED = "recovered"

#: States as emitted by :mod:`services.circuit_breaker`. Kept as plain strings
#: so this module never needs to import the breaker (avoiding a cycle).
_STATE_OPEN = "OPEN"
_STATE_CLOSED = "CLOSED"

#: HTTP header carrying the HMAC-SHA256 signature, matching the callback webhook.
SIGNATURE_HEADER = "X-Signature-256"


class CircuitBreakerAlertPayload(BaseModel):
    """Canonical wire payload for a circuit-breaker alert.

    Serialised to camelCase (like :class:`schemas.callback.AiCallbackPayload`)
    so a receiver can share field-parsing conventions across both webhooks.
    """

    alert_type: str = Field(
        default="circuit_breaker",
        alias="alertType",
        description="Discriminator for consumers multiplexing several alert types.",
    )
    event: str = Field(
        ...,
        description="One of 'opened' or 'recovered'.",
    )
    provider: str = Field(
        ...,
        description="Provider whose breaker changed state (e.g. 'openai').",
        min_length=1,
    )
    from_state: str = Field(..., alias="fromState", description="Previous state.")
    to_state: str = Field(..., alias="toState", description="New state.")
    failure_count: int = Field(
        ...,
        alias="failureCount",
        ge=0,
        description="Failure count recorded at the moment of the transition.",
    )
    reason: str = Field(
        default="",
        description="Breaker's own reason string for the transition.",
    )
    timestamp: str = Field(
        ...,
        description="ISO-8601 UTC timestamp of the transition "
        "(e.g. 2026-09-23T10:30:00Z).",
    )
    service: str = Field(
        default="soter-ai-service",
        description="Emitting service, so a shared alert sink can route by source.",
    )
    schema_version: str = Field(
        default=SCHEMA_VERSION,
        alias="schemaVersion",
        description="Payload schema version for forward-compatibility checks.",
    )

    model_config = {"populate_by_name": True, "by_alias": True}

    def to_json_bytes(self) -> bytes:
        """Serialise to the canonical wire format (camelCase JSON, UTF-8)."""
        return self.model_dump_json(by_alias=True).encode("utf-8")

    def sign(self, secret: str) -> str:
        """Return the lowercase hex HMAC-SHA256 of the body for ``secret``."""
        return hmac.new(
            secret.encode("utf-8"),
            self.to_json_bytes(),
            hashlib.sha256,
        ).hexdigest()


def event_for_transition(from_state: str, to_state: str) -> Optional[str]:
    """Map a breaker state change to an alertable event, or ``None``.

    Only real transitions to ``OPEN`` and ``CLOSED`` qualify; half-open probes
    and no-op transitions return ``None``.
    """
    if to_state == _STATE_OPEN and from_state != _STATE_OPEN:
        return ALERT_EVENT_OPENED
    if to_state == _STATE_CLOSED and from_state != _STATE_CLOSED:
        return ALERT_EVENT_RECOVERED
    return None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def deliver_alert_webhook(url: str, body_bytes: bytes, headers: Dict[str, str]) -> None:
    """Synchronously POST an alert body to *url*.

    Raises on any non-2xx response or connection failure so the caller can
    count and log the failure. Kept as a module-level function so tests can
    substitute a fake sink.
    """
    with httpx.Client(timeout=10.0) as client:
        response = client.post(url, content=body_bytes, headers=headers)
        if response.status_code >= 400:
            raise RuntimeError(
                f"Alert webhook delivery failed: {response.status_code} - "
                f"{response.text}"
            )


class CircuitBreakerAlerter:
    """Emits de-duplicated circuit-breaker alerts to a webhook.

    Thread-safe: transitions are observed from request-handling threads, so the
    de-duplication bookkeeping is guarded by a lock. Delivery itself is
    dispatched on a short-lived daemon thread by default so it never adds
    latency to the request path.
    """

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        secret: Optional[str] = None,
        dedup_window_seconds: float = 300.0,
        background: bool = True,
        time_fn: Optional[Callable[[], float]] = None,
        deliver_fn: Optional[Callable[[str, bytes, Dict[str, str]], None]] = None,
    ):
        self._webhook_url = webhook_url
        self._secret = secret
        # A non-positive window disables de-duplication (every event is sent).
        self._dedup_window = max(0.0, float(dedup_window_seconds))
        self._background = background
        self._time = time_fn or time.time
        self._deliver = deliver_fn or deliver_alert_webhook

        self._lock = threading.Lock()
        self._last_sent: Dict[Tuple[str, str], float] = {}

        #: Observability counters (also useful in tests).
        self.sent_count = 0
        self.suppressed_count = 0
        self.failed_count = 0

    @property
    def enabled(self) -> bool:
        """Alerts are only delivered when a webhook URL is configured."""
        return bool(self._webhook_url)

    def notify_transition(
        self,
        provider: str,
        from_state: str,
        to_state: str,
        failure_count: int,
        reason: str = "",
    ) -> bool:
        """Alert on an alertable transition; return whether one was dispatched.

        Returns ``False`` when alerts are disabled, when the transition is not
        alertable, or when it was de-duplicated. Never raises.
        """
        if not self.enabled:
            return False

        event = event_for_transition(from_state, to_state)
        if event is None:
            return False

        now = self._time()
        with self._lock:
            if self._is_duplicate(provider, event, now):
                self.suppressed_count += 1
                self._record_metric(provider, event, "suppressed")
                logger.info(
                    "circuit_breaker_alert_suppressed provider=%s event=%s "
                    "dedup_window_seconds=%s",
                    provider,
                    event,
                    self._dedup_window,
                )
                return False
            self._last_sent[(provider, event)] = now

        payload = CircuitBreakerAlertPayload(
            event=event,
            provider=provider,
            from_state=from_state,
            to_state=to_state,
            failure_count=failure_count,
            reason=reason,
            timestamp=_utc_now_iso(),
        )
        self._dispatch(provider, event, payload)
        return True

    def _is_duplicate(self, provider: str, event: str, now: float) -> bool:
        last = self._last_sent.get((provider, event))
        if last is None:
            return False
        return (now - last) < self._dedup_window

    def _dispatch(
        self, provider: str, event: str, payload: CircuitBreakerAlertPayload
    ) -> None:
        body = payload.to_json_bytes()
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self._secret:
            headers[SIGNATURE_HEADER] = payload.sign(self._secret)
        else:
            logger.warning(
                "circuit_breaker_alert_unsigned provider=%s event=%s — set "
                "AI_WEBHOOK_SECRET to sign alert webhooks",
                provider,
                event,
            )

        if self._background:
            threading.Thread(
                target=self._deliver_safely,
                args=(provider, event, body, headers),
                daemon=True,
            ).start()
        else:
            self._deliver_safely(provider, event, body, headers)

    def _deliver_safely(
        self, provider: str, event: str, body: bytes, headers: Dict[str, str]
    ) -> None:
        if self._webhook_url is None:  # pragma: no cover - guarded by `enabled`
            return
        try:
            self._deliver(self._webhook_url, body, headers)
        except Exception as exc:  # noqa: BLE001 - alerting must never raise
            self.failed_count += 1
            self._record_metric(provider, event, "failed")
            logger.error(
                "circuit_breaker_alert_delivery_failed provider=%s event=%s error=%s",
                provider,
                event,
                exc,
            )
            return

        self.sent_count += 1
        self._record_metric(provider, event, "sent")
        logger.warning(
            "circuit_breaker_alert_sent provider=%s event=%s",
            provider,
            event,
            extra={"provider": provider, "event": event},
        )

    @staticmethod
    def _record_metric(provider: str, event: str, outcome: str) -> None:
        # Imported lazily so a metrics problem can never break alerting, and so
        # this module stays importable in minimal environments.
        try:
            import metrics

            metrics.CIRCUIT_BREAKER_ALERTS_TOTAL.labels(
                provider=provider, event=event, outcome=outcome
            ).inc()
        except Exception:  # pragma: no cover - metrics are best-effort
            pass


# ---------------------------------------------------------------------------
# Process-wide singleton wired from settings
# ---------------------------------------------------------------------------

_UNSET = object()
_alerter: object = _UNSET


def build_alerter_from_settings(
    source: Optional[object] = None,
) -> Optional[CircuitBreakerAlerter]:
    """Build an alerter from settings, or ``None`` when alerting is off.

    Alerting is off when ``CIRCUIT_BREAKER_ALERTS_ENABLED`` is false, or when
    no ``CIRCUIT_BREAKER_ALERT_WEBHOOK_URL`` is configured.
    """
    source = source or settings
    if not getattr(source, "circuit_breaker_alerts_enabled", True):
        return None
    url = getattr(source, "circuit_breaker_alert_webhook_url", None)
    if not url:
        return None
    return CircuitBreakerAlerter(
        webhook_url=str(url),
        secret=getattr(source, "ai_webhook_secret", None),
        dedup_window_seconds=getattr(
            source, "circuit_breaker_alert_dedup_seconds", 300.0
        ),
    )


def get_alerter() -> Optional[CircuitBreakerAlerter]:
    """Return the process-wide alerter, building it from settings on first use."""
    global _alerter
    if _alerter is _UNSET:
        _alerter = build_alerter_from_settings()
    return _alerter  # type: ignore[return-value]


def set_alerter(alerter: Optional[CircuitBreakerAlerter]) -> None:
    """Override the process-wide alerter (used by tests and custom wiring)."""
    global _alerter
    _alerter = alerter


def reset_alerter_for_tests() -> None:
    """Force the next :func:`get_alerter` call to rebuild from settings."""
    global _alerter
    _alerter = _UNSET


def notify_breaker_transition(
    provider: str,
    from_state: str,
    to_state: str,
    failure_count: int,
    reason: str = "",
) -> bool:
    """Forward a breaker transition to the configured alerter (if any).

    This is the single entry point :class:`~services.circuit_breaker.
    CircuitBreaker` calls; it is a no-op when alerting is not configured.
    """
    alerter = get_alerter()
    if alerter is None:
        return False
    return alerter.notify_transition(
        provider=provider,
        from_state=from_state,
        to_state=to_state,
        failure_count=failure_count,
        reason=reason,
    )
