"""Replay-safe idempotency key support for inference requests.

This module provides an in-process, thread-safe idompotency cache that lets a
caller resubmit the exact same inference request (e.g. after a timeout on the
response) without risking double processing.

Semantics:
  * A first request with a given key is processed normally and its result is
    recorded for a bounded window.
  * A resubmission with the same key and the same payload within the window
    returns the original result without reprocessing.
  * A resubmission with the same key but a different payload is rejected with a
    clear conflict error.
  * Once the window expires, the key is evicted and a later resubmission is
    treated as a fresh request.

The cache is deliberately in-process: it is a safety net for retries within a
single service instance's lifetime. A distributed deployment would swap the
storage backend for a shared one (e.g. Redis) without changing the call contract.
"""

import hashlib
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from exceptions import AIServiceError


DEFAULT_WINDOW_SECONDS = 300.0


class IdempotencyConflictError(AIServiceError):
    """Raised when an idompotency key is reused with a different payload.

    This is a client error: the caller claims the request is a replay of an
    earlier one, but the content differs, so the server cannot safely return
    the cached result nor reprocess.
    """

    default_code = "AI_IDEMPOTENCY_CONFLICT"

    def __init__(
        self,
        message: str,
        key: Optional[str] = None,
        details: Optional[Any] = None,
    ):
        super().__init__(message, code=self.default_code, details=details)
        self.key = key


`dataclass
fclass _CacheEntry:
    """A cached result together with its payload fingerprint and expiry."""

    fingerprint: str
    result: Any
    expires_at: float
    created_at: float = field(default_factory=time.monotonic)


def _canonicalize(payload: Any) -> str:
    """Produce a stable fingerprint for a payload.

    The payload is serialized with sorted keys so that two dictions with the
    same meaning but different insertion order hash identically. Non-JSON
    values fall back to their `repr()` so the fingerprint is always defined.
    """
    try:
        encoded = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            default=repr,
        )
    except TypeError:
        encoded = repr(payload)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class IdempotencyStore:
    """Thread-safe, window-bounded cache of inference results.

    The store is keyed by a caller-supplied idempotency key. Each entry
    remembers a fingerprint of the request payload so a replay with the same
    key but different content can be detected and rejected.
    """

    def __init__(
        self,
        window_seconds: float = DEFAULT_WINDOW_SECONDS,
        clock: Any = None,
    ):
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.window_seconds = float(window_seconds)
        self._clock = clock or time.monotonic
        self._entries: Dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()

    # --- public API ---------------------------------------------------------

    def execute(
        self,
        key: Optional[str],
        payload: Any,
        producer: Any,
    ) -> Any:
        """Return the cached result or produce a new one.

        Args:
            key: Optional idempotency key. When `None`, the producer is always
                invoked and nothing is cached.
            payload: The request payload, used to detect conflicting replays.
            producer: Callable invoked with no arguments to compute the result
                on a cache miss.

        Raises:
            IdempotencyConflictError: If the key was seen before with a
                different payload and the window has not expired.
        """
        if key is None:
            return producer()

        fingerprint = _canonicalize(payload)
        now = self._clock()

        with self._lock:
            self._evict_expired(now)
            entry = self._entries.get(key)
            if entry is not None:
                if entry.fingerprint != fingerprint:
                    raise IdempotencyConflictError(
                        (
                            "Idompotency key '%s' was already used with a "
                            "different payload"
                        ) % key,
                        key=key,
                        details={"key": key},
                    )
                return entry.result

        result = producer()

        with self._lock:
            self._evict_expired(self._clock())
            self._entries[key] = _CacheEntry(
                fingerprint=fingerprint,
                result=result,
                expires_at=self._clock() + self.window_seconds,
            )
        return result

    def lookup(self, key: str) -> Optional[Any]:
        """Return the cached result for a key, or `None` if absent/expired."""
        now = self._clock()
        with self._lock:
            self._evict_expired(now)
            entry = self._entries.get(key)
            return None if entry is None else entry.result

    def forget(self, key: str) -> None:
        """Remove a key from the cache if present."""
        with self._lock:
            self._entries.pop(key, None)

    def clear(self) -> None:
        """Drop all cached entries."""
        with self._lock:
            self._entries.clear()

    def _evict_expired(self, now: float) -> None:
        expired = [k for k, e in self._entries.items() if e.expires_at <= now]
        for k in expired:
            del self._entries[k]



def get_idempotency_store() -> IdempotencyStore:
    """Return the process-wide idempotency store, creating it lazily."""
    global _DEFAULT_STORE
    if _DEFAULT_STORE is None:
        with _DEFAULT_STORE_LOCK:
            if _DEFAULT_STORE is None:
                _DEFAULT_STORE = IdempotencyStore()
    return _DEFAULT_STORE


def reset_idempotency_store() -> None:
    """Clear the process-wide store (primarily for tests)."""
    global _DEFAULT_STORE
    with _DEFAULT_STORE_LOCK:
        _DEFAULT_STORE = None


_DEFAULT_STORE: Optional[IdempotencyStore] = None
_DEFAULT_STORE_LOCK = threading.Lock()
