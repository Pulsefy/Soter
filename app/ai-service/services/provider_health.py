"""Provider health registry for tracking failures and degradation status.

Issue #770 — Add Provider Health Registry and Degradation Status

Tracks recent failures per provider, exposes a centralized health registry,
and allows routes to surface degraded/fallback mode without leaking secrets.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from threading import Lock
from typing import Any, Dict, List, Optional

from config import settings
from services.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)


class ProviderStatus(str, Enum):
    """High-level status for a provider."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    DOWN = "down"


@dataclass
class ProviderHealthRecord:
    """Snapshot of a provider's current health."""

    name: str
    status: ProviderStatus
    circuit_state: str
    failure_count: int
    failure_threshold: int
    last_failure_at: Optional[float] = None
    last_success_at: Optional[float] = None
    consecutive_failures: int = 0
    total_failures_1h: int = 0
    total_successes_1h: int = 0
    error_rate: float = 0.0

    def to_dict(self, public: bool = True) -> Dict[str, Any]:
        """Serialize to dict.  When ``public=True`` omit internal details."""
        base = {
            "name": self.name,
            "status": self.status.value,
            "circuit_state": self.circuit_state,
        }
        if not public:
            base.update(
                {
                    "failure_count": self.failure_count,
                    "failure_threshold": self.failure_threshold,
                    "last_failure_at": self.last_failure_at,
                    "last_success_at": self.last_success_at,
                    "consecutive_failures": self.consecutive_failures,
                    "total_failures_1h": self.total_failures_1h,
                    "total_successes_1h": self.total_successes_1h,
                    "error_rate": round(self.error_rate, 4),
                }
            )
        return base


@dataclass
class _FailureEvent:
    """Internal event record with timestamp."""

    timestamp: float
    provider: str
    error_code: Optional[str] = None


class ProviderHealthRegistry:
    """Thread-safe registry that records recent provider failures.

    Maintains a rolling window of failure events per provider and computes
    aggregate health status.  Integrates with ``CircuitBreaker`` instances
    to surface OPEN/HALF_OPEN states as ``DOWN`` / ``DEGRADED``.
    """

    ROLLING_WINDOW_SECONDS: float = 3600.0
    MAX_EVENTS_PER_PROVIDER: int = 1000
    DEGRADED_CONSECUTIVE_THRESHOLD: int = 2
    DEGRADED_ERROR_RATE: float = 0.25

    def __init__(self) -> None:
        self._events: Dict[str, deque] = {}
        self._consecutive_failures: Dict[str, int] = {}
        self._consecutive_successes: Dict[str, int] = {}
        self._last_failure_at: Dict[str, float] = {}
        self._last_success_at: Dict[str, float] = {}
        self._lock = Lock()

    def record_failure(self, provider_name: str, error_code: Optional[str] = None) -> None:
        now = time.time()
        with self._lock:
            self._ensure_queue(provider_name)
            self._events[provider_name].append(
                _FailureEvent(timestamp=now, provider=provider_name, error_code=error_code)
            )
            self._consecutive_failures[provider_name] = (
                self._consecutive_failures.get(provider_name, 0) + 1
            )
            self._consecutive_successes[provider_name] = 0
            self._last_failure_at[provider_name] = now
            self._trim(provider_name)
        logger.warning(
            "Provider '%s' failure recorded (code=%s)", provider_name, error_code
        )

    def record_success(self, provider_name: str) -> None:
        now = time.time()
        with self._lock:
            self._consecutive_successes[provider_name] = (
                self._consecutive_successes.get(provider_name, 0) + 1
            )
            self._consecutive_failures[provider_name] = 0
            self._last_success_at[provider_name] = now

    def get_health(
        self,
        provider_name: str,
        circuit_breaker: Optional[CircuitBreaker] = None,
    ) -> ProviderHealthRecord:
        now = time.time()
        with self._lock:
            self._trim(provider_name)
            events = list(self._events.get(provider_name, deque()))
            failures_1h = len(events)
            successes_1h = self._consecutive_successes.get(provider_name, 0)
            total = failures_1h + successes_1h
            error_rate = failures_1h / total if total > 0 else 0.0

            cb_state = circuit_breaker.state if circuit_breaker else "CLOSED"
            cb_failures = circuit_breaker.failure_count if circuit_breaker else 0
            cb_threshold = (
                circuit_breaker.failure_threshold if circuit_breaker else 3
            )

            status = self._compute_status(
                cb_state=cb_state,
                consecutive_failures=self._consecutive_failures.get(provider_name, 0),
                error_rate=error_rate,
            )

            return ProviderHealthRecord(
                name=provider_name,
                status=status,
                circuit_state=cb_state,
                failure_count=cb_failures,
                failure_threshold=cb_threshold,
                last_failure_at=self._last_failure_at.get(provider_name),
                last_success_at=self._last_success_at.get(provider_name),
                consecutive_failures=self._consecutive_failures.get(provider_name, 0),
                total_failures_1h=failures_1h,
                total_successes_1h=successes_1h,
                error_rate=error_rate,
            )

    def all_health(
        self,
        circuit_breakers: Optional[Dict[str, CircuitBreaker]] = None,
    ) -> List[ProviderHealthRecord]:
        cb_map = circuit_breakers or {}
        with self._lock:
            names = set(self._events.keys()) | set(cb_map.keys())
        return [self.get_health(name, cb_map.get(name)) for name in names]

    def overall_status(self, circuit_breakers: Optional[Dict[str, CircuitBreaker]] = None) -> ProviderStatus:
        records = self.all_health(circuit_breakers)
        if not records:
            return ProviderStatus.HEALTHY
        if any(r.status == ProviderStatus.DOWN for r in records):
            return ProviderStatus.DEGRADED if any(
                r.status == ProviderStatus.HEALTHY for r in records
            ) else ProviderStatus.DOWN
        if any(r.status == ProviderStatus.DEGRADED for r in records):
            return ProviderStatus.DEGRADED
        return ProviderStatus.HEALTHY

    def clear(self, provider_name: Optional[str] = None) -> None:
        with self._lock:
            if provider_name:
                self._events.pop(provider_name, None)
                self._consecutive_failures.pop(provider_name, None)
                self._consecutive_successes.pop(provider_name, None)
                self._last_failure_at.pop(provider_name, None)
                self._last_success_at.pop(provider_name, None)
            else:
                self._events.clear()
                self._consecutive_failures.clear()
                self._consecutive_successes.clear()
                self._last_failure_at.clear()
                self._last_success_at.clear()

    def _ensure_queue(self, provider_name: str) -> None:
        if provider_name not in self._events:
            self._events[provider_name] = deque(maxlen=self.MAX_EVENTS_PER_PROVIDER)

    def _trim(self, provider_name: str) -> None:
        cutoff = time.time() - self.ROLLING_WINDOW_SECONDS
        q = self._events.get(provider_name)
        if q is None:
            return
        while q and q[0].timestamp < cutoff:
            q.popleft()

    def _compute_status(
        self,
        *,
        cb_state: str,
        consecutive_failures: int,
        error_rate: float,
    ) -> ProviderStatus:
        if cb_state == "OPEN":
            return ProviderStatus.DOWN
        if cb_state == "HALF_OPEN":
            return ProviderStatus.DEGRADED
        if consecutive_failures >= self.DEGRADED_CONSECUTIVE_THRESHOLD:
            return ProviderStatus.DEGRADED
        if error_rate >= self.DEGRADED_ERROR_RATE:
            return ProviderStatus.DEGRADED
        return ProviderStatus.HEALTHY


provider_health_registry = ProviderHealthRegistry()