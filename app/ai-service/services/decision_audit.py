"""Durable structured audit records for verification and fraud decisions.

Every decision endpoint that can influence whether aid is disbursed
(``/v1/ai/humanitarian/verify`` and ``/v1/fraud/detect``) writes a structured
audit record that captures:

* **inputs** - the request data that drove the decision (redacted before
  persistence using :mod:`logging_redaction`),
* **provider / model / prompt_version** - which model pipeline produced the
  outcome,
* **outcome** - the decision itself (verdict / risk scores), confidence, and
  reasons,
* **correlation anchors** - ``trace_id``, ``claim_id``, and ``campaign_ref``.

Records are persisted to a local SQLite database so they survive process
restarts, can be queried by trace id / claim id / campaign reference, and are
subject to a configurable retention window (see ``DECISION_AUDIT_RETENTION_DAYS``
in :mod:`config`). The store is intentionally fail-safe: a persistence error is
logged and never raised, so auditing can never break the decision response.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from logging_redaction import redact

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decision_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    prompt_version TEXT,
    claim_id TEXT,
    campaign_ref TEXT,
    outcome TEXT NOT NULL,
    confidence REAL,
    reasons TEXT,
    inputs TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_audit_trace ON decision_audit(trace_id);
CREATE INDEX IF NOT EXISTS idx_decision_audit_claim ON decision_audit(claim_id);
CREATE INDEX IF NOT EXISTS idx_decision_audit_campaign ON decision_audit(campaign_ref);
CREATE INDEX IF NOT EXISTS idx_decision_audit_created ON decision_audit(created_at);
"""


def _json_default(value: Any) -> str:
    """Best-effort stringification for values JSON cannot serialize."""
    try:
        return str(value)
    except Exception:
        return repr(value)


class DecisionAuditStore:
    """SQLite-backed store for structured decision audit records.

    Args:
        db_path: Filesystem path of the SQLite database file.
        retention_days: Records older than this many days are pruned by
            :meth:`prune`. Configurable via ``DECISION_AUDIT_RETENTION_DAYS``.
        enabled: When ``False``, :meth:`record_decision` is a no-op and
            :meth:`query` / :meth:`count` return empty results. This lets
            operators disable auditing without code changes.
    """

    def __init__(
        self,
        db_path: str,
        retention_days: int = 90,
        enabled: bool = True,
    ) -> None:
        self.db_path = db_path
        self.retention_days = max(1, int(retention_days))
        self.enabled = enabled
        self._lock = threading.RLock()
        self._conn: Optional[sqlite3.Connection] = None
        if enabled:
            parent = os.path.dirname(db_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            self._conn = sqlite3.connect(db_path, check_same_thread=False)
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    def record_decision(
        self,
        *,
        trace_id: Optional[str],
        decision_type: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        prompt_version: Optional[str] = None,
        claim_id: Optional[str] = None,
        campaign_ref: Optional[str] = None,
        outcome: Any = None,
        confidence: Optional[float] = None,
        reasons: Optional[List[str]] = None,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> Optional[int]:
        """Persist one structured decision audit record.

        All free-form fields (``outcome``, ``reasons``, ``inputs``) are
        serialized to JSON and redacted with :func:`logging_redaction.redact`
        before persistence so PII/secrets never reach disk. Returns the new
        row id, or ``None`` when the store is disabled or the write fails.
        """
        if not self.enabled or self._conn is None:
            return None

        now = datetime.now(timezone.utc).isoformat()
        redacted_inputs = redact(json.dumps(inputs or {}, default=_json_default))
        redacted_outcome = redact(json.dumps(outcome, default=_json_default))
        redacted_reasons = redact(
            json.dumps(reasons or [], default=_json_default)
        )

        try:
            with self._lock:
                cur = self._conn.execute(
                    """
                    INSERT INTO decision_audit (
                        trace_id, created_at, decision_type, provider, model,
                        prompt_version, claim_id, campaign_ref, outcome,
                        confidence, reasons, inputs
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        trace_id or "",
                        now,
                        decision_type,
                        provider,
                        model,
                        prompt_version,
                        claim_id,
                        campaign_ref,
                        redacted_outcome,
                        confidence,
                        redacted_reasons,
                        redacted_inputs,
                    ),
                )
                self._conn.commit()
                return cur.lastrowid
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("decision_audit_write_failed error=%s", exc)
            return None

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------

    def query(
        self,
        *,
        trace_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        campaign_ref: Optional[str] = None,
        decision_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Return audit records matching the given filters.

        Records can be filtered by ``trace_id``, ``claim_id``, and
        ``campaign_ref`` (any combination), newest first.
        """
        if not self.enabled or self._conn is None:
            return []

        clauses: List[str] = []
        params: List[Any] = []
        if trace_id:
            clauses.append("trace_id = ?")
            params.append(trace_id)
        if claim_id:
            clauses.append("claim_id = ?")
            params.append(claim_id)
        if campaign_ref:
            clauses.append("campaign_ref = ?")
            params.append(campaign_ref)
        if decision_type:
            clauses.append("decision_type = ?")
            params.append(decision_type)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(int(max(1, min(200, limit))))
        params.append(int(max(0, offset)))

        try:
            with self._lock:
                rows = self._conn.execute(
                    f"""
                    SELECT id, trace_id, created_at, decision_type, provider,
                           model, prompt_version, claim_id, campaign_ref,
                           outcome, confidence, reasons, inputs
                    FROM decision_audit
                    {where}
                    ORDER BY id DESC
                    LIMIT ? OFFSET ?
                    """,
                    params,
                ).fetchall()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("decision_audit_query_failed error=%s", exc)
            return []

        columns = [
            "id",
            "trace_id",
            "created_at",
            "decision_type",
            "provider",
            "model",
            "prompt_version",
            "claim_id",
            "campaign_ref",
            "outcome",
            "confidence",
            "reasons",
            "inputs",
        ]
        records: List[Dict[str, Any]] = []
        for row in rows:
            record = dict(zip(columns, row))
            record["outcome"] = json.loads(record["outcome"])
            record["reasons"] = json.loads(record["reasons"] or "[]")
            record["inputs"] = json.loads(record["inputs"])
            records.append(record)
        return records

    def count(
        self,
        *,
        trace_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        campaign_ref: Optional[str] = None,
        decision_type: Optional[str] = None,
    ) -> int:
        """Count audit records matching the given filters."""
        if not self.enabled or self._conn is None:
            return 0

        clauses: List[str] = []
        params: List[Any] = []
        if trace_id:
            clauses.append("trace_id = ?")
            params.append(trace_id)
        if claim_id:
            clauses.append("claim_id = ?")
            params.append(claim_id)
        if campaign_ref:
            clauses.append("campaign_ref = ?")
            params.append(campaign_ref)
        if decision_type:
            clauses.append("decision_type = ?")
            params.append(decision_type)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        try:
            with self._lock:
                row = self._conn.execute(
                    f"SELECT COUNT(*) FROM decision_audit {where}",
                    params,
                ).fetchone()
                return int(row[0]) if row else 0
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("decision_audit_count_failed error=%s", exc)
            return 0

    # ------------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------------

    def prune(self, retention_days: Optional[int] = None) -> int:
        """Delete records older than the retention window.

        Uses ``retention_days`` if given, otherwise the store's configured
        value. Returns the number of records deleted.
        """
        if not self.enabled or self._conn is None:
            return 0

        window = self.retention_days if retention_days is None else max(1, int(retention_days))
        cutoff = (datetime.now(timezone.utc) - timedelta(days=window)).isoformat()
        try:
            with self._lock:
                cur = self._conn.execute(
                    "DELETE FROM decision_audit WHERE created_at < ?", (cutoff,)
                )
                self._conn.commit()
                deleted = cur.rowcount
                if deleted:
                    logger.info("decision_audit_pruned deleted=%d", deleted)
                return deleted
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("decision_audit_prune_failed error=%s", exc)
            return 0

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
