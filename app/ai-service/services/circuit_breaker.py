import logging
import time
from threading import Lock
from typing import Dict, Optional

try:
    from prometheus_client import Gauge
except ImportError:  # pragma: no cover - metrics are optional
    Gauge = None


CLOSED = "CLOSED"
OPEN = "OPEN"
HALF_OPEN = "HALF_OPEN"
_STATES = (CLOSED, OPEN, HALF_OPEN)

logger = logging.getLogger(__name__)


if Gauge is not None:
    _STATE_GAUGE = Gauge(
        "circuit_breaker_state",
        "Current circuit breaker state (1 for active state, 0 otherwise)",
        ("provider", "state"),
    )
else:
    _STATE_GAUGE = None


class CircuitBreakerRegistry:
    """Thread-safe registry of configured circuit breakers."""

    _breakers: Dict[str, "CircuitBreaker"] = {}
    _lock = Lock()

    @classmethod
    def register(cls, breaker: "CircuitBreaker") -> None:
        with cls._lock:
            cls._breakers[breaker.name] = breaker

    @classmethod
    def get(cls, provider: str) -> Optional["CircuitBreaker"]:
        with cls._lock:
            return cls._breakers.get(provider)

    @classmethod
    def all_states(cls) -> Dict[str, dict]:
        with cls._lock:
            breakers = list(cls._breakers.items())
        return {provider: breaker.get_state() for provider, breaker in breakers}

    @classmethod
    def reset(cls, provider: str, reason: str = "manual_reset") -> dict:
        breaker = cls.get(provider)
        if breaker is None:
            raise KeyError(provider)
        breaker.reset(reason=reason)
        return breaker.get_state()

    @classmethod
    def _clear_for_tests(cls) -> None:
        with cls._lock:
            cls._breakers.clear()


class CircuitBreaker:
    """Thread-safe implementation of the circuit breaker pattern."""

    def __init__(
        self, name: str, failure_threshold: int = 3, recovery_timeout: float = 30.0
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = CLOSED
        self.failure_count = 0
        self.last_state_change = time.time()
        self._lock = Lock()

        CircuitBreakerRegistry.register(self)
        self._update_metric()

    def _update_metric(self) -> None:
        if _STATE_GAUGE is None:
            return
        for state in _STATES:
            _STATE_GAUGE.labels(provider=self.name, state=state).set(
                1 if state == self.state else 0
            )

    def _transition(self, state: str, reason: str, level: int = logging.INFO) -> None:
        previous_state = self.state
        self.state = state
        self.last_state_change = time.time()
        self._update_metric()
        logger.log(
            level,
            "circuit_breaker_state_transition provider=%s from_state=%s "
            "to_state=%s failure_count=%s reason=%s",
            self.name,
            previous_state,
            state,
            self.failure_count,
            reason,
            extra={
                "provider": self.name,
                "from_state": previous_state,
                "to_state": state,
                "failure_count": self.failure_count,
                "reason": reason,
            },
        )

    def allow_request(self) -> bool:
        with self._lock:
            if self.state == OPEN:
                elapsed = time.time() - self.last_state_change
                if elapsed >= self.recovery_timeout:
                    self._transition(
                        HALF_OPEN,
                        f"recovery_timeout_elapsed:{self.recovery_timeout}s",
                    )
                    return True
                return False
            return True

    def record_success(self) -> None:
        with self._lock:
            if self.state == HALF_OPEN:
                self.failure_count = 0
                self._transition(CLOSED, "probe_succeeded")
            elif self.state == CLOSED:
                self.failure_count = 0

    def record_failure(self) -> None:
        with self._lock:
            self.failure_count += 1
            if self.state == HALF_OPEN:
                self._transition(OPEN, "probe_failed", logging.WARNING)
            elif self.state == CLOSED and self.failure_count >= self.failure_threshold:
                self._transition(
                    OPEN,
                    "failure_threshold_reached:"
                    f"{self.failure_count}/{self.failure_threshold}",
                    logging.WARNING,
                )

    def time_until_retry(self) -> float:
        with self._lock:
            if self.state != OPEN:
                return 0.0
            elapsed = time.time() - self.last_state_change
            return max(0.0, self.recovery_timeout - elapsed)

    def get_state(self) -> dict:
        with self._lock:
            if self.state == OPEN:
                elapsed = time.time() - self.last_state_change
                retry = max(0.0, self.recovery_timeout - elapsed)
            else:
                retry = 0.0
            return {
                "provider": self.name,
                "state": self.state,
                "failure_count": self.failure_count,
                "time_until_retry": retry,
            }

    def reset(self, reason: str = "manual_reset") -> None:
        with self._lock:
            self.failure_count = 0
            self._transition(CLOSED, reason)
