"""Durable, queryable decision audit records for verification and fraud decisions.

Issue #990: verification and fraud endpoints return decisions that influence
whether aid is disbursed, but nothing durably recorded *why*. This module is
the system of record for those decisions.

How each acceptance criterion is met
------------------------------------
1. **Every decision writes an audit record with inputs, provider, model, prompt
   version, and outcome.** :class:`DecisionAuditRecord` carries all five plus
   the reasons and confidence behind the outcome. The verification and fraud
   endpoints call :meth:`DecisionAuditStore.record` on the success path *and*
   in their failure handlers, so a rejected/errored decision is as auditable
   as an approved one.
2. **Records are queryable by trace id, claim id, and campaign reference.**
   The store maintains three in-memory indexes (``trace_id``, ``claim_id``,
   ``campaign_ref``) over the durable log; see :meth:`DecisionAuditStore.query`
   and the ``/v1/ai/decision-audit`` endpoints.
3. **Sensitive fields are redacted per logging_redaction.py before
   persistence.** :func:`_redact_value` walks the whole record (inputs,
   reasons, metadata - nested dicts and lists included) through
   ``logging_redaction.redact`` *before* the record is serialised, so no
   unredacted value ever reaches the disk.
4. **Records survive process restart.** Storage is an append-only JSON Lines
   file, flushed and ``os.fsync``-ed per append. On construction the store
   replays the file to rebuild its indexes, so restarts keep both the data and
   its queryability. (Unlike ``services/dead_letter.py``, an in-memory-only
   operational aid, audit records are a system of record and must be durable.)
5. **Retention is configurable and documented.** ``DECISION_AUDIT_RETENTION_DAYS``
   drives :meth:`DecisionAuditStore.prune`, which runs on load and periodically
   on write, compacting the log atomically. ``0`` disables expiry. See
   ``DECISION_AUDIT.md``.

The store never raises into a request path: :meth:`DecisionAuditStore.record`
swallows and logs storage failures so an audit-disk problem can never block an
aid decision from being returned.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass, field
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Set

from logging_redaction import redact

logger = logging.getLogger(__name__)

__all__ = [
    "AUDIT_RECORD_SCHEMA_VERSION",
    "DecisionAuditRecord",
    "DecisionAuditStore",
    "build_store_from_settings",
    "get_store",
    "set_store",
]

#: Bumped whenever the on-disk record shape changes, so a reader can tell
#: which schema a historical line was written under.
AUDIT_RECORD_SCHEMA_VERSION = "1"

#: Number of appends between opportunistic retention sweeps. Pruning rewrites
#: the whole log, so it must not run on every single write.
_PRUNE_EVERY_N_WRITES = 100

_SECONDS_PER_DAY = 86400.0


def _redact_value(value: Any) -> Any:
    """Recursively apply ``logging_redaction.redact`` to every string in *value*.

    Dict keys are left intact (they are field names, not secrets) while every
    string leaf - including those nested inside lists and dicts - is masked.
    Non-string scalars pass through unchanged so numeric scores and booleans
    stay analysable.
    """
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {str(k): _redact_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_value(v) for v in value]
    return value


@dataclass
class DecisionAuditRecord:
    """A single durable record of one automated decision.

    ``inputs`` holds the request-side material the decision was made from
    (claim text, evidence, context factors, claim metadata). It is redacted
    before persistence, so callers may pass it verbatim.
    """

    decision_type: str
    outcome: str
    record_id: str = field(default_factory=lambda: "da_" + uuid.uuid4().hex)
    created_at: float = field(default_factory=time.time)
    trace_id: Optional[str] = None
    claim_id: Optional[str] = None
    campaign_ref: Optional[str] = None
    package_id: Optional[str] = None
    org_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_version: Optional[str] = None
    prompt_variant: Optional[str] = None
    confidence: Optional[float] = None
    reasons: List[str] = field(default_factory=list)
    inputs: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    schema_version: str = AUDIT_RECORD_SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def redacted(self) -> "DecisionAuditRecord":
        """Return a copy with every string field masked per logging_redaction."""
        data = self.to_dict()
        # Identifiers are correlation handles, not PII, and redacting them
        # would destroy the very indexes the audit trail exists to serve.
        preserved = {
            key: data[key]
            for key in (
                "record_id",
                "created_at",
                "decision_type",
                "outcome",
                "trace_id",
                "claim_id",
                "campaign_ref",
                "package_id",
                "confidence",
                "schema_version",
            )
        }
        redacted = _redact_value(data)
        redacted.update(preserved)
        return DecisionAuditRecord(**redacted)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DecisionAuditRecord":
        known = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


class DecisionAuditStore:
    """Append-only, restart-durable store of :class:`DecisionAuditRecord`.

    Args:
        path: JSON Lines file backing the store. Parent directories are
            created on demand.
        retention_days: Records older than this are dropped on the next
            prune. ``0`` (or negative) keeps records forever.
        enabled: When ``False`` the store accepts calls and no-ops, so a
            deployment can turn auditing off without code changes.
    """

    def __init__(
        self,
        path: str,
        retention_days: float = 90.0,
        enabled: bool = True,
    ) -> None:
        self.path = os.path.abspath(path)
        self.retention_days = retention_days
        self.enabled = enabled
        self._lock = Lock()
        self._records: List[DecisionAuditRecord] = []
        self._by_trace: Dict[str, List[str]] = {}
        self._by_claim: Dict[str, List[str]] = {}
        self._by_campaign: Dict[str, List[str]] = {}
        self._by_id: Dict[str, DecisionAuditRecord] = {}
        self._writes_since_prune = 0

        if self.enabled:
            self._load()

    # -- durability ------------------------------------------------------

    def _load(self) -> None:
        """Replay the on-disk log so records survive a process restart.

        Malformed lines (a torn write from a hard kill, say) are skipped
        rather than fatal: a partially readable audit trail beats a service
        that will not boot.
        """
        if not os.path.exists(self.path):
            return
        loaded: List[DecisionAuditRecord] = []
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        loaded.append(DecisionAuditRecord.from_dict(json.loads(line)))
                    except Exception:
                        logger.warning(
                            "decision_audit_skipped_malformed_line",
                            extra={"event": "decision_audit_load"},
                        )
        except OSError as exc:
            logger.error("decision_audit_load_failed: %s", exc)
            return

        for record in loaded:
            self._index(record)
        if self._prune_locked():
            try:
                self._rewrite_locked()
            except OSError as exc:
                logger.error("decision_audit_prune_rewrite_failed: %s", exc)

    def _append_to_disk(self, record: DecisionAuditRecord) -> None:
        """Append one record and fsync so it survives an abrupt restart."""
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.to_dict(), sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def _rewrite_locked(self) -> None:
        """Atomically rewrite the log from the in-memory records."""
        directory = os.path.dirname(self.path) or "."
        os.makedirs(directory, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                for record in self._records:
                    handle.write(json.dumps(record.to_dict(), sort_keys=True) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        except Exception:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise

    # -- indexing --------------------------------------------------------

    def _index(self, record: DecisionAuditRecord) -> None:
        self._records.append(record)
        self._by_id[record.record_id] = record
        if record.trace_id:
            self._by_trace.setdefault(record.trace_id, []).append(record.record_id)
        if record.claim_id:
            self._by_claim.setdefault(record.claim_id, []).append(record.record_id)
        if record.campaign_ref:
            self._by_campaign.setdefault(record.campaign_ref, []).append(
                record.record_id
            )

    def _reindex_locked(self) -> None:
        records = list(self._records)
        self._records = []
        self._by_id = {}
        self._by_trace = {}
        self._by_claim = {}
        self._by_campaign = {}
        for record in records:
            self._index(record)

    # -- retention -------------------------------------------------------

    def _prune_locked(self) -> bool:
        """Drop expired records in memory. Returns True when anything was removed."""
        if self.retention_days is None or self.retention_days <= 0:
            return False
        cutoff = time.time() - (self.retention_days * _SECONDS_PER_DAY)
        keep = [r for r in self._records if r.created_at >= cutoff]
        if len(keep) == len(self._records):
            return False
        self._records = keep
        self._reindex_locked()
        return True

    def prune(self) -> int:
        """Apply the retention policy and compact the log.

        Returns the number of expired records dropped.
        """
        with self._lock:
            before = len(self._records)
            if not self._prune_locked():
                return 0
            dropped = before - len(self._records)
            try:
                self._rewrite_locked()
            except OSError as exc:
                logger.error("decision_audit_prune_rewrite_failed: %s", exc)
            return dropped

    # -- writing ---------------------------------------------------------

    def record(
        self,
        decision_type: str,
        outcome: str,
        *,
        trace_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        campaign_ref: Optional[str] = None,
        package_id: Optional[str] = None,
        org_id: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        prompt_version: Optional[str] = None,
        prompt_variant: Optional[str] = None,
        confidence: Optional[float] = None,
        reasons: Optional[Iterable[str]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[DecisionAuditRecord]:
        """Redact, persist, and index one decision.

        Returns the stored (already redacted) record, or ``None`` when
        auditing is disabled or persistence failed. Never raises: an audit
        write must not be able to fail an aid decision that already happened.
        """
        if not self.enabled:
            return None
        try:
            record = DecisionAuditRecord(
                decision_type=decision_type,
                outcome=outcome,
                trace_id=trace_id or None,
                claim_id=claim_id or None,
                campaign_ref=campaign_ref or None,
                package_id=package_id or None,
                org_id=org_id or None,
                provider=provider,
                model=model,
                prompt_version=prompt_version,
                prompt_variant=prompt_variant,
                confidence=confidence,
                reasons=[str(r) for r in (reasons or [])],
                inputs=dict(inputs or {}),
                metadata=dict(metadata or {}),
            ).redacted()

            with self._lock:
                self._append_to_disk(record)
                self._index(record)
                self._writes_since_prune += 1
                if self._writes_since_prune >= _PRUNE_EVERY_N_WRITES:
                    self._writes_since_prune = 0
                    if self._prune_locked():
                        try:
                            self._rewrite_locked()
                        except OSError as exc:
                            logger.error("decision_audit_prune_rewrite_failed: %s", exc)
            return record
        except Exception as exc:  # pragma: no cover - defensive
            logger.error(
                "decision_audit_write_failed: %s",
                exc,
                extra={"event": "decision_audit_write_failed"},
            )
            return None

    # -- reading ---------------------------------------------------------

    def get(self, record_id: str) -> Optional[DecisionAuditRecord]:
        with self._lock:
            return self._by_id.get(record_id)

    def query(
        self,
        *,
        trace_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        campaign_ref: Optional[str] = None,
        decision_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[DecisionAuditRecord]:
        """Return matching records, newest first.

        Supplying several identifiers intersects them (logical AND), so an
        operator can narrow to "this claim, on this campaign" precisely.
        """
        with self._lock:
            candidate_ids: Optional[Set[str]] = None
            for value, index in (
                (trace_id, self._by_trace),
                (claim_id, self._by_claim),
                (campaign_ref, self._by_campaign),
            ):
                if not value:
                    continue
                ids = set(index.get(value, []))
                candidate_ids = ids if candidate_ids is None else candidate_ids & ids

            if candidate_ids is None:
                matches = list(self._records)
            else:
                matches = [
                    self._by_id[rid] for rid in candidate_ids if rid in self._by_id
                ]

            if decision_type:
                matches = [r for r in matches if r.decision_type == decision_type]

            matches.sort(key=lambda r: r.created_at, reverse=True)
            if limit and limit > 0:
                matches = matches[:limit]
            return matches

    def __len__(self) -> int:
        with self._lock:
            return len(self._records)


def build_store_from_settings(settings: Any) -> DecisionAuditStore:
    """Construct a store from the application ``Settings`` object."""
    return DecisionAuditStore(
        path=settings.decision_audit_path,
        retention_days=settings.decision_audit_retention_days,
        enabled=settings.decision_audit_enabled,
    )


#: Process-wide store. ``main.py`` builds it at import time and also puts it on
#: ``app.state.decision_audit_store``; endpoints prefer app state and fall back
#: here so background/Celery paths can audit too.
_store: Optional[DecisionAuditStore] = None


def set_store(store: Optional[DecisionAuditStore]) -> None:
    global _store
    _store = store


def get_store() -> Optional[DecisionAuditStore]:
    return _store
