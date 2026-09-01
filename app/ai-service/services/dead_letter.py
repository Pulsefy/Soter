"""
Dead-letter queue for failed callback deliveries and exhausted async jobs.

Operators need a safe way to recover from transient outages (a flaky backend
webhook endpoint, a Redis blip, a downstream provider hiccup) without manual
patching. This module tracks items that failed terminally - a webhook
delivery that kept 4xx/5xx-ing, or a Celery task that exhausted its retry
budget - and exposes replay controls with an audit trail and a rate limit so
replay cannot be used to hammer a downstream system or loop forever.

Storage is in-memory (module-level singleton), matching the pattern already
used for Celery task status in ``tasks.task_results`` - acceptable because
dead-letter items are an operational recovery aid, not a system of record.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Dict, List, Literal, Optional

from config import settings

logger = logging.getLogger(__name__)

DeadLetterKind = Literal["callback", "async_job"]
DeadLetterStatus = Literal["pending", "succeeded", "exhausted"]


class DeadLetterError(Exception):
    """Raised for invalid dead-letter operations."""


@dataclass
class ReplayAttempt:
    """A single audited replay attempt."""

    attempt: int
    actor: str
    outcome: Literal["succeeded", "failed"]
    timestamp: float
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "attempt": self.attempt,
            "actor": self.actor,
            "outcome": self.outcome,
            "timestamp": self.timestamp,
            "error": self.error,
        }


@dataclass
class DeadLetterEntry:
    """A single dead-lettered item awaiting operator replay."""

    id: str
    kind: DeadLetterKind
    task_id: str
    payload: Dict[str, Any]
    error: str
    task_type: Optional[str] = None
    status: DeadLetterStatus = "pending"
    attempts: int = 0
    max_attempts: int = 5
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    last_attempt_at: Optional[float] = None
    audit_log: List[ReplayAttempt] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "task_id": self.task_id,
            "task_type": self.task_type,
            "payload": self.payload,
            "error": self.error,
            "status": self.status,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_attempt_at": self.last_attempt_at,
            "audit_log": [a.to_dict() for a in self.audit_log],
        }


class DeadLetterQueue:
    """Thread-safe in-memory dead-letter store with rate-limited replay."""

    def __init__(self, max_attempts: int, cooldown_seconds: float):
        self.max_attempts = max_attempts
        self.cooldown_seconds = cooldown_seconds
        self._entries: Dict[str, DeadLetterEntry] = {}
        self._lock = Lock()

    @staticmethod
    def make_id(kind: DeadLetterKind, task_id: str) -> str:
        """Deterministic ID so re-adding the same failed task updates it in place."""
        return f"{kind}:{task_id}"

    def add(
        self,
        kind: DeadLetterKind,
        task_id: str,
        payload: Dict[str, Any],
        error: str,
        task_type: Optional[str] = None,
    ) -> DeadLetterEntry:
        """Record a terminally-failed callback delivery or async job."""
        entry_id = self.make_id(kind, task_id)
        with self._lock:
            existing = self._entries.get(entry_id)
            now = time.time()
            if existing is not None:
                existing.error = error
                existing.payload = payload
                existing.task_type = task_type or existing.task_type
                existing.status = "pending"
                existing.updated_at = now
                logger.warning(
                    "dead_letter_item_updated",
                    extra={
                        "dead_letter_id": entry_id,
                        "kind": kind,
                        "task_id": task_id,
                    },
                )
                return existing

            entry = DeadLetterEntry(
                id=entry_id,
                kind=kind,
                task_id=task_id,
                payload=payload,
                error=error,
                task_type=task_type,
                max_attempts=self.max_attempts,
            )
            self._entries[entry_id] = entry
            logger.warning(
                "dead_letter_item_added",
                extra={"dead_letter_id": entry_id, "kind": kind, "task_id": task_id},
            )
            return entry

    def list(
        self,
        kind: Optional[DeadLetterKind] = None,
        status: Optional[DeadLetterStatus] = None,
    ) -> List[DeadLetterEntry]:
        with self._lock:
            items = list(self._entries.values())
        if kind is not None:
            items = [i for i in items if i.kind == kind]
        if status is not None:
            items = [i for i in items if i.status == status]
        return sorted(items, key=lambda i: i.created_at, reverse=True)

    def get(self, entry_id: str) -> Optional[DeadLetterEntry]:
        with self._lock:
            return self._entries.get(entry_id)

    def check_replayable(self, entry_id: str) -> DeadLetterEntry:
        """
        Validate that an item may be replayed right now.

        Raises DeadLetterError with a machine-readable code in one of:
        ``not_found``, ``already_succeeded``, ``exhausted``, ``rate_limited``.
        """
        with self._lock:
            entry = self._entries.get(entry_id)
            if entry is None:
                raise DeadLetterError("not_found")
            if entry.status == "succeeded":
                raise DeadLetterError("already_succeeded")
            if entry.status == "exhausted":
                raise DeadLetterError("exhausted")
            if (
                entry.last_attempt_at is not None
                and (time.time() - entry.last_attempt_at) < self.cooldown_seconds
            ):
                raise DeadLetterError("rate_limited")
            return entry

    def record_attempt(
        self, entry_id: str, actor: str, success: bool, error: Optional[str] = None
    ) -> DeadLetterEntry:
        """Append an audited replay attempt and update entry status."""
        with self._lock:
            entry = self._entries.get(entry_id)
            if entry is None:
                raise DeadLetterError("not_found")

            now = time.time()
            entry.attempts += 1
            entry.last_attempt_at = now
            entry.updated_at = now
            entry.audit_log.append(
                ReplayAttempt(
                    attempt=entry.attempts,
                    actor=actor,
                    outcome="succeeded" if success else "failed",
                    timestamp=now,
                    error=None if success else error,
                )
            )

            if success:
                entry.status = "succeeded"
            elif entry.attempts >= entry.max_attempts:
                entry.status = "exhausted"
            else:
                entry.status = "pending"

            logger.info(
                "dead_letter_replay_recorded",
                extra={
                    "dead_letter_id": entry_id,
                    "attempt": entry.attempts,
                    "outcome": entry.status,
                    "actor": actor,
                },
            )
            return entry

    def clear(self) -> None:
        """Test helper - drop all entries."""
        with self._lock:
            self._entries.clear()


dead_letter_queue = DeadLetterQueue(
    max_attempts=settings.dead_letter_max_replay_attempts,
    cooldown_seconds=settings.dead_letter_replay_cooldown_seconds,
)
