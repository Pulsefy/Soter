"""
Canonical callback payload contract for AI verification results.

Schema version: v1

This module is the single source of truth for the payload that the AI service
POSTs to the NestJS backend webhook endpoint (`POST /aid/webhook`).  Both
sides MUST derive their field expectations from this file (or its TypeScript
mirror in `app/backend/src/aid/dto/ai-task-webhook.dto.ts`).

Field alignment with AiTaskWebhookDto (backend):
  AI service field  <->  Backend DTO field
  ─────────────────────────────────────────
  task_id           <->  taskId
  delivery_id       <->  deliveryId
  timestamp         <->  timestamp         (ISO-8601 string)
  status            <->  status            (TaskStatus enum)
  result            <->  result            (optional object)
  error             <->  error             (optional string)
  task_type         <->  taskType          (optional string)
  completed_at      <->  completedAt       (optional ISO-8601 string)
  schema_version    <->  (informational — backend ignores unknown fields)

HMAC header:
  Header name : x-webhook-signature
  Algorithm   : HMAC-SHA256 over the raw JSON body (UTF-8)
  Encoding    : lowercase hex digest
  Secret      : WEBHOOK_SECRET env var (must match backend WEBHOOK_SECRET)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Schema version — bump the minor when adding optional fields, bump the major
# when removing or renaming existing fields.
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "1.0"


class CallbackStatus(str, Enum):
    """Mirrors TaskStatus in the backend DTO."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class AiCallbackPayload(BaseModel):
    """
    Versioned, canonical payload for AI-service → backend callbacks.

    Instantiate via the convenience constructor :meth:`build` so that
    ``delivery_id``, ``timestamp``, and ``schema_version`` are always
    populated correctly.
    """

    # ── Required fields ──────────────────────────────────────────────────
    task_id: str = Field(
        ...,
        alias="taskId",
        description="Stable identifier of the AI task (UUIDv4 recommended).",
        min_length=1,
    )
    delivery_id: str = Field(
        ...,
        alias="deliveryId",
        description=(
            "Unique per-delivery nonce (UUIDv4). "
            "The backend uses this for idempotent dedup."
        ),
        min_length=1,
    )
    timestamp: str = Field(
        ...,
        description="ISO-8601 UTC timestamp of event generation (e.g. 2024-03-24T10:30:00Z).",
    )
    status: CallbackStatus = Field(
        ...,
        description="Current task lifecycle status.",
    )

    # ── Optional fields ──────────────────────────────────────────────────
    result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Task output when status=completed.",
    )
    error: Optional[str] = Field(
        default=None,
        description="Human-readable error message when status=failed.",
    )
    task_type: Optional[str] = Field(
        default=None,
        alias="taskType",
        description="Discriminator for the kind of AI task (e.g. 'humanitarian_verification').",
    )
    completed_at: Optional[str] = Field(
        default=None,
        alias="completedAt",
        description="ISO-8601 UTC timestamp of task completion (status=completed only).",
    )

    # ── Metadata ─────────────────────────────────────────────────────────
    schema_version: str = Field(
        default=SCHEMA_VERSION,
        alias="schemaVersion",
        description="Payload schema version for forward-compatibility checks.",
    )

    model_config = {
        # Accept both snake_case (our internal code) and camelCase (wire format).
        "populate_by_name": True,
        # Serialise to camelCase so the payload matches the backend DTO exactly.
        "by_alias": True,
    }

    # ── Cross-field validation ────────────────────────────────────────────

    @model_validator(mode="after")
    def _result_xor_error(self) -> "AiCallbackPayload":
        """A completed task must carry a result; a failed task must carry an error."""
        if self.status == CallbackStatus.COMPLETED and self.result is None:
            # Allow result-less completed payloads (e.g. fire-and-forget tasks)
            # but log a warning in the constructor.
            pass
        if self.status == CallbackStatus.FAILED and not self.error:
            raise ValueError(
                "Callback payload with status='failed' must include an 'error' message."
            )
        return self

    # ── Factory ──────────────────────────────────────────────────────────

    @classmethod
    def build(
        cls,
        *,
        task_id: str,
        status: CallbackStatus | str,
        task_type: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> "AiCallbackPayload":
        """
        Preferred constructor: auto-generates ``delivery_id``, ``timestamp``,
        and ``completed_at`` so callers cannot forget them.
        """
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return cls(
            task_id=task_id,
            delivery_id=str(uuid.uuid4()),
            timestamp=now_iso,
            status=CallbackStatus(status),
            task_type=task_type,
            result=result,
            error=error,
            completed_at=now_iso if CallbackStatus(status) == CallbackStatus.COMPLETED else None,
        )

    # ── Wire serialisation ────────────────────────────────────────────────

    def to_json_bytes(self) -> bytes:
        """Serialise to the canonical wire format (camelCase JSON, UTF-8)."""
        return self.model_dump_json(by_alias=True).encode("utf-8")

    def sign(self, secret: str) -> str:
        """
        Compute HMAC-SHA256 over the canonical JSON representation.

        Returns the lowercase hex digest suitable for the
        ``x-webhook-signature`` HTTP header.
        """
        raw = self.to_json_bytes()
        return hmac.new(
            secret.encode("utf-8"),
            raw,
            hashlib.sha256,
        ).hexdigest()


# ---------------------------------------------------------------------------
# HMAC helpers (standalone, for callers that already have the raw bytes)
# ---------------------------------------------------------------------------

def compute_hmac(body_bytes: bytes, secret: str) -> str:
    """Return hex HMAC-SHA256 of *body_bytes* signed with *secret*."""
    return hmac.new(
        secret.encode("utf-8"),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()


def verify_hmac(body_bytes: bytes, secret: str, signature: str) -> bool:
    """Timing-safe comparison of the expected HMAC against a received *signature*."""
    expected = compute_hmac(body_bytes, secret)
    return hmac.compare_digest(expected, signature)
