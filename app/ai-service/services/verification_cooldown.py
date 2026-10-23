"""Cooldown storage for repeated verification attempts on the same identity."""

import hashlib
import threading
import time
from typing import Any, Dict, Optional


class VerificationCooldown:
    """Store recent successful verification results by tenant-scoped identity."""

    def __init__(self):
        self._lock = threading.Lock()
        self._results: Dict[str, Dict[str, Any]] = {}
        self._clock = time.time

    @staticmethod
    def make_key(org_id: str, identity: str) -> str:
        """Return a digest so claim and artifact identifiers are not stored in keys."""
        identity_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        org_hash = hashlib.sha256(org_id.encode("utf-8")).hexdigest()
        return f"cache:ai:verification_cooldown:{org_hash}:{identity_hash}"

    def get(
        self, cache: Any, key: str, cooldown_seconds: int
    ) -> Optional[Dict[str, Any]]:
        """Get the previous successful result if its cooldown is still active."""
        if cooldown_seconds <= 0:
            return None

        now = self._clock()
        cached = None
        if getattr(cache, "enabled", False):
            cached = cache.get(key)

        with self._lock:
            records = [
                record
                for record in (cached, self._results.get(key))
                if self._is_active(record, now, cooldown_seconds)
            ]
            if records:
                latest = max(records, key=lambda record: record["completed_at"])
                self._results[key] = latest
                return latest["result"]
            self._results.pop(key, None)
        return None

    def store(
        self, cache: Any, key: str, result: Dict[str, Any], cooldown_seconds: int
    ) -> None:
        """Remember a successful result for the configured interval."""
        if cooldown_seconds <= 0:
            return

        record = {"completed_at": self._clock(), "result": result}
        with self._lock:
            expired = [
                existing_key
                for existing_key, existing_record in self._results.items()
                if not self._is_active(
                    existing_record, record["completed_at"], cooldown_seconds
                )
            ]
            for existing_key in expired:
                del self._results[existing_key]
            self._results[key] = record

        if getattr(cache, "enabled", False):
            cache.set(key, record, cooldown_seconds)

    @staticmethod
    def _is_active(record: Any, now: float, cooldown_seconds: int) -> bool:
        if not isinstance(record, dict) or not isinstance(record.get("result"), dict):
            return False
        completed_at = record.get("completed_at")
        return (
            isinstance(completed_at, (int, float))
            and 0 <= now - completed_at < cooldown_seconds
        )

    def reset(self) -> None:
        """Clear in-process entries, primarily for test isolation."""
        with self._lock:
            self._results.clear()


verification_cooldown = VerificationCooldown()
