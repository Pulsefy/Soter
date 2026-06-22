import time
import logging
from threading import Lock

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """
    A thread-safe implementation of the Circuit Breaker pattern.
    
    States:
    - CLOSED: Normal operation. Requests flow through.
    - OPEN: Service is failing. Requests fail-fast (return False/raise error).
    - HALF_OPEN: Recovery window elapsed. Allow a request to test downstream health.
    """

    def __init__(self, name: str, failure_threshold: int = 3, recovery_timeout: float = 30.0):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self.failure_count = 0
        self.last_state_change = time.time()
        self._lock = Lock()

    def allow_request(self) -> bool:
        """
        Check if a request is allowed to proceed.
        If in OPEN state and recovery timeout has elapsed, transitions to HALF_OPEN.
        """
        with self._lock:
            now = time.time()
            if self.state == "OPEN":
                if now - self.last_state_change >= self.recovery_timeout:
                    logger.info(
                        "Circuit breaker for provider '%s' transitioning from OPEN to HALF_OPEN "
                        "(recovery timeout %ss elapsed)",
                        self.name,
                        self.recovery_timeout,
                    )
                    self.state = "HALF_OPEN"
                    self.last_state_change = now
                    return True
                return False
            return True

    def record_success(self) -> None:
        """
        Record a successful request.
        If in HALF_OPEN, transitions back to CLOSED and resets failure count.
        """
        with self._lock:
            now = time.time()
            if self.state == "HALF_OPEN":
                logger.info(
                    "Circuit breaker for provider '%s' transitioning from HALF_OPEN to CLOSED "
                    "(successful probe request)",
                    self.name,
                )
                self.state = "CLOSED"
                self.failure_count = 0
                self.last_state_change = now
            elif self.state == "CLOSED":
                self.failure_count = 0

    def record_failure(self) -> None:
        """
        Record a failed request.
        If in CLOSED and threshold is reached, or if in HALF_OPEN, transitions to OPEN.
        """
        with self._lock:
            now = time.time()
            self.failure_count += 1
            if self.state == "HALF_OPEN" or self.failure_count >= self.failure_threshold:
                logger.warning(
                    "Circuit breaker for provider '%s' transitioning from %s to OPEN "
                    "(failures: %s, threshold: %s)",
                    self.name,
                    self.state,
                    self.failure_count,
                    self.failure_threshold,
                )
                self.state = "OPEN"
                self.last_state_change = now
