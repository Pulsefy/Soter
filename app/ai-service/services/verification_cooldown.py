"""In-memory verification cooldown service.

Prevents rapid re-verification of the same claim identity by enforcing a
configurable minimum interval between processing attempts.  When a request
arrives within the cooldown window the prior result is returned immediately
with ``from_cooldown=True`` so callers can distinguish a fresh computation
from a replayed one.

Design notes
------------
* Pure in-memory: no Redis dependency.  The same trade-off as
  ``services/rate_limiter.py`` — a process restart clears the cooldown, which
  is acceptable for a best-effort abuse-prevention mechanism.  Redis-backed
  persistence can be layered on top later without changing the interface.
* Thread/async safe: all mutations go through a single ``threading.Lock`` so
  the store is safe for both sync and async callers (FastAPI runs async
  handlers in the same event loop; locks acquired briefly in the request path
  are fine).
* LRU-bounded: the store is capped at ``max_entries`` to prevent unbounded
  memory growth under a high-cardinality claim-ID space.  When the cap is
  reached the oldest entry is evicted (FIFO approximation via
  ``collections.OrderedDict``).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Sentinel returned when no prior result has been stored yet.
_MISSING = object()

# Maximum number of entries kept in the in-memory store. Old entries are
# evicted once this limit is reached (FIFO order) to bound memory use.
_DEFAULT_MAX_ENTRIES = 10_000


class VerificationCooldownService:
    """Enforce a minimum re-verification interval per claim identity.

    Parameters
    ----------
    cooldown_seconds:
        Minimum number of seconds that must elapse between two verification
        attempts for the same identity key.  ``0`` (or any non-positive value)
        disables the cooldown entirely — every request is processed fresh.
    max_entries:
        Maximum number of claim identities tracked simultaneously.  When
        exceeded the oldest entry is evicted.
    """

    def __init__(
        self,
        cooldown_seconds: float,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
    ) -> None:
        self._cooldown_seconds = float(cooldown_seconds)
        self._max_entries = max_entries
        # Maps identity_key -> {"ts": float, "result": Any}
        self._store: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def cooldown_seconds(self) -> float:
        return self._cooldown_seconds

    def check(self, identity_key: str) -> Tuple[bool, Optional[Any]]:
        """Check whether ``identity_key`` is within its cooldown window.

        Returns
        -------
        (in_cooldown, prior_result)
            ``in_cooldown`` is ``True`` when the key was last verified less
            than ``cooldown_seconds`` ago **and** a prior result was stored.
            ``prior_result`` is the previously stored value, or ``None`` when
            ``in_cooldown`` is ``False``.
        """
        if self._cooldown_seconds <= 0:
            return False, None

        with self._lock:
            entry = self._store.get(identity_key)
            if entry is None:
                return False, None

            elapsed = time.monotonic() - entry["ts"]
            if elapsed < self._cooldown_seconds:
                logger.debug(
                    "verification_cooldown_hit",
                    extra={
                        "event": "verification_cooldown_hit",
                        "identity_key": identity_key,
                        "elapsed_seconds": round(elapsed, 3),
                        "cooldown_seconds": self._cooldown_seconds,
                    },
                )
                return True, entry.get("result")

            # Elapsed ≥ cooldown: entry exists but is stale — leave it in place
            # so ``record`` can overwrite it on the next fresh computation.
            return False, None

    def record(self, identity_key: str, result: Any) -> None:
        """Store ``result`` as the most-recent outcome for ``identity_key``.

        This should be called immediately after a fresh verification completes
        so the cooldown window starts from now.
        """
        if self._cooldown_seconds <= 0:
            return

        with self._lock:
            if identity_key in self._store:
                # Move to end (most-recently-used) so eviction hits the oldest.
                self._store.move_to_end(identity_key)
            elif len(self._store) >= self._max_entries:
                # Evict the oldest entry (first item in the OrderedDict).
                evicted_key, _ = self._store.popitem(last=False)
                logger.debug(
                    "verification_cooldown_evicted",
                    extra={
                        "event": "verification_cooldown_evicted",
                        "evicted_key": evicted_key,
                    },
                )

            self._store[identity_key] = {
                "ts": time.monotonic(),
                "result": result,
            }

    def reset(self) -> None:
        """Clear all cooldown state.  Intended for tests only."""
        with self._lock:
            self._store.clear()

    def remaining_seconds(self, identity_key: str) -> float:
        """Return how many seconds remain in the cooldown for ``identity_key``.

        Returns ``0.0`` when there is no active cooldown.
        """
        if self._cooldown_seconds <= 0:
            return 0.0

        with self._lock:
            entry = self._store.get(identity_key)
            if entry is None:
                return 0.0
            elapsed = time.monotonic() - entry["ts"]
            remaining = self._cooldown_seconds - elapsed
            return max(0.0, remaining)


def build_humanitarian_key(
    claim_id: Optional[str],
    aid_claim: str,
    artifact_ids: list,
) -> str:
    """Derive a stable identity key for a humanitarian verification request.

    Preference is given to the explicit ``claim_id`` from ``anchor_metadata``
    because it is stable across retries.  When absent the key is derived from
    the claim text and sorted artifact IDs so that functionally identical
    requests share the same cooldown slot.

    Parameters
    ----------
    claim_id:
        ``anchor_metadata.claim_id`` — may be ``None``.
    aid_claim:
        The claim text (used as a fallback when ``claim_id`` is absent).
    artifact_ids:
        List of artifact IDs referenced by the claim.
    """
    if claim_id:
        return f"humanitarian:{claim_id}"

    # Fallback: a short content-derived key.  We do NOT hash here (to keep the
    # key human-readable in logs) but we do truncate to 120 chars to avoid
    # extremely long keys from verbose claim text.
    artifact_part = ",".join(sorted(artifact_ids)) if artifact_ids else ""
    raw = f"{aid_claim}|{artifact_part}"
    truncated = raw[:120]
    return f"humanitarian:{truncated}"


def build_fraud_key(claim_id: Optional[str]) -> Optional[str]:
    """Derive a stable identity key for a fraud detection request.

    Returns ``None`` when there is no claim_id (batch requests without an
    anchor claim_id cannot be deduplicated meaningfully).
    """
    if not claim_id:
        return None
    return f"fraud:{claim_id}"


# ---------------------------------------------------------------------------
# Process-wide singleton — shared across all requests in one process.
# ---------------------------------------------------------------------------
# Lazily initialised on first access via ``get_cooldown_service()`` below
# so import-time side-effects stay minimal and tests can override freely.

_cooldown_service: Optional[VerificationCooldownService] = None
_singleton_lock = threading.Lock()


def get_cooldown_service() -> VerificationCooldownService:
    """Return (and lazily create) the process-wide cooldown service."""
    global _cooldown_service
    if _cooldown_service is not None:
        return _cooldown_service
    with _singleton_lock:
        if _cooldown_service is None:
            from config import settings

            _cooldown_service = VerificationCooldownService(
                cooldown_seconds=settings.verification_cooldown_seconds,
            )
            logger.info(
                "verification_cooldown_initialised",
                extra={
                    "event": "verification_cooldown_initialised",
                    "cooldown_seconds": settings.verification_cooldown_seconds,
                },
            )
    return _cooldown_service
