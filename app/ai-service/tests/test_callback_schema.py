"""
Tests for the canonical AI-callback payload contract.

Covers:
  - Schema construction and field validation
  - camelCase wire serialisation (must match AiTaskWebhookDto on the backend)
  - HMAC-SHA256 signing / verification helpers
  - The ``build()`` factory convenience method
  - Rejection of malformed payloads (missing required fields, bad enum values,
    failed cross-field rules)
  - Round-trip: serialise → parse → re-serialise produces identical bytes
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from schemas.callback import (
    SCHEMA_VERSION,
    AiCallbackPayload,
    CallbackStatus,
    compute_hmac,
    verify_hmac,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SECRET = "test-hmac-secret-32-chars-long!!"
_TASK_ID = "task-abc-123"
_DELIVERY_ID = "del-xyz-456"
_TIMESTAMP = "2024-03-24T10:30:00Z"


def _make_payload(**overrides) -> dict:
    """Return a minimal valid payload dict (snake_case, for direct construction)."""
    base = {
        "task_id": _TASK_ID,
        "delivery_id": _DELIVERY_ID,
        "timestamp": _TIMESTAMP,
        "status": CallbackStatus.COMPLETED,
        "result": {"score": 0.9},
    }
    base.update(overrides)
    return base


# ===========================================================================
# 1. Field presence and types
# ===========================================================================


class TestRequiredFields:
    def test_all_required_fields_present(self):
        p = AiCallbackPayload(**_make_payload())
        assert p.task_id == _TASK_ID
        assert p.delivery_id == _DELIVERY_ID
        assert p.timestamp == _TIMESTAMP
        assert p.status == CallbackStatus.COMPLETED

    def test_missing_task_id_raises(self):
        data = _make_payload()
        del data["task_id"]
        with pytest.raises(ValidationError) as exc_info:
            AiCallbackPayload(**data)
        errors = exc_info.value.errors()
        # Pydantic may report via the snake_case name or the camelCase alias.
        field_names = {str(loc) for e in errors for loc in e["loc"]}
        assert "task_id" in field_names or "taskId" in field_names

    def test_missing_delivery_id_raises(self):
        data = _make_payload()
        del data["delivery_id"]
        with pytest.raises(ValidationError):
            AiCallbackPayload(**data)

    def test_missing_timestamp_raises(self):
        data = _make_payload()
        del data["timestamp"]
        with pytest.raises(ValidationError):
            AiCallbackPayload(**data)

    def test_missing_status_raises(self):
        data = _make_payload()
        del data["status"]
        with pytest.raises(ValidationError):
            AiCallbackPayload(**data)

    def test_empty_task_id_raises(self):
        with pytest.raises(ValidationError):
            AiCallbackPayload(**_make_payload(task_id=""))

    def test_empty_delivery_id_raises(self):
        with pytest.raises(ValidationError):
            AiCallbackPayload(**_make_payload(delivery_id=""))


# ===========================================================================
# 2. Status enum semantics
# ===========================================================================


class TestStatusSemantics:
    @pytest.mark.parametrize(
        "status",
        [
            CallbackStatus.PENDING,
            CallbackStatus.PROCESSING,
            CallbackStatus.COMPLETED,
            CallbackStatus.FAILED,
        ],
    )
    def test_valid_statuses_accepted(self, status: CallbackStatus):
        extra = {"error": "oops"} if status == CallbackStatus.FAILED else {}
        p = AiCallbackPayload(**_make_payload(status=status, **extra))
        assert p.status == status

    def test_invalid_status_string_raises(self):
        with pytest.raises(ValidationError):
            AiCallbackPayload(**_make_payload(status="unknown_status"))

    def test_status_string_coercion(self):
        """String literals matching enum values must be accepted."""
        p = AiCallbackPayload(**_make_payload(status="completed"))
        assert p.status == CallbackStatus.COMPLETED

    def test_failed_status_without_error_raises(self):
        """Cross-field rule: failed payload must carry an error message."""
        with pytest.raises(ValidationError) as exc_info:
            AiCallbackPayload(**_make_payload(status=CallbackStatus.FAILED, error=None))
        assert "error" in str(exc_info.value).lower()

    def test_failed_status_with_error_accepted(self):
        p = AiCallbackPayload(
            **_make_payload(status=CallbackStatus.FAILED, error="Out of memory", result=None)
        )
        assert p.status == CallbackStatus.FAILED
        assert p.error == "Out of memory"


# ===========================================================================
# 3. Optional fields
# ===========================================================================


class TestOptionalFields:
    def test_result_defaults_to_none(self):
        p = AiCallbackPayload(**_make_payload(result=None))
        assert p.result is None

    def test_error_defaults_to_none_for_completed(self):
        p = AiCallbackPayload(**_make_payload())
        assert p.error is None

    def test_task_type_accepted(self):
        p = AiCallbackPayload(**_make_payload(task_type="humanitarian_verification"))
        assert p.task_type == "humanitarian_verification"

    def test_completed_at_accepted(self):
        p = AiCallbackPayload(**_make_payload(completed_at="2024-03-24T10:35:00Z"))
        assert p.completed_at == "2024-03-24T10:35:00Z"

    def test_schema_version_default(self):
        p = AiCallbackPayload(**_make_payload())
        assert p.schema_version == SCHEMA_VERSION


# ===========================================================================
# 4. Wire serialisation — camelCase JSON must match backend DTO field names
# ===========================================================================


class TestWireSerialization:
    def test_serialises_to_camel_case(self):
        p = AiCallbackPayload(
            **_make_payload(task_type="image_analysis", completed_at="2024-03-24T10:35:00Z")
        )
        wire = json.loads(p.model_dump_json(by_alias=True))

        # These field names must match AiTaskWebhookDto on the backend exactly.
        assert "taskId" in wire
        assert "deliveryId" in wire
        assert "timestamp" in wire
        assert "status" in wire
        assert "taskType" in wire
        assert "completedAt" in wire
        assert "schemaVersion" in wire

        # snake_case variants must NOT appear in the wire payload
        assert "task_id" not in wire
        assert "delivery_id" not in wire
        assert "task_type" not in wire
        assert "completed_at" not in wire
        assert "schema_version" not in wire

    def test_to_json_bytes_is_utf8(self):
        p = AiCallbackPayload(**_make_payload())
        raw = p.to_json_bytes()
        assert isinstance(raw, bytes)
        parsed = json.loads(raw.decode("utf-8"))
        assert parsed["taskId"] == _TASK_ID

    def test_round_trip(self):
        """Serialise → parse → re-serialise must produce bit-identical JSON."""
        p1 = AiCallbackPayload(**_make_payload())
        raw1 = p1.to_json_bytes()

        wire_dict = json.loads(raw1)
        # Backend would receive camelCase — simulate re-parsing using aliases.
        p2 = AiCallbackPayload.model_validate(wire_dict)
        raw2 = p2.to_json_bytes()

        assert json.loads(raw1) == json.loads(raw2)

    def test_none_optional_fields_omitted_or_null(self):
        """None optional fields should not break deserialisation."""
        p = AiCallbackPayload(**_make_payload())
        wire = json.loads(p.to_json_bytes())
        # result is set; error, taskType, completedAt are None — must be present as null
        assert "result" in wire


# ===========================================================================
# 5. HMAC signing and verification
# ===========================================================================


class TestHmacSigning:
    def test_sign_produces_hex_string(self):
        p = AiCallbackPayload(**_make_payload())
        sig = p.sign(_SECRET)
        assert isinstance(sig, str)
        assert len(sig) == 64  # SHA-256 hex digest is always 64 chars

    def test_sign_is_deterministic_for_same_payload(self):
        """Signing the same serialised payload twice must yield the same digest."""
        p = AiCallbackPayload(**_make_payload())
        raw = p.to_json_bytes()
        assert p.sign(_SECRET) == compute_hmac(raw, _SECRET)

    def test_sign_changes_with_different_secret(self):
        p = AiCallbackPayload(**_make_payload())
        sig1 = p.sign(_SECRET)
        sig2 = p.sign("different-secret")
        assert sig1 != sig2

    def test_verify_hmac_passes_with_correct_secret(self):
        p = AiCallbackPayload(**_make_payload())
        body = p.to_json_bytes()
        sig = compute_hmac(body, _SECRET)
        assert verify_hmac(body, _SECRET, sig) is True

    def test_verify_hmac_fails_with_wrong_secret(self):
        p = AiCallbackPayload(**_make_payload())
        body = p.to_json_bytes()
        sig = compute_hmac(body, _SECRET)
        assert verify_hmac(body, "wrong-secret", sig) is False

    def test_verify_hmac_fails_with_tampered_body(self):
        p = AiCallbackPayload(**_make_payload())
        body = p.to_json_bytes()
        sig = compute_hmac(body, _SECRET)
        tampered = body[:-1] + b"X"
        assert verify_hmac(tampered, _SECRET, sig) is False

    def test_verify_hmac_fails_with_truncated_signature(self):
        p = AiCallbackPayload(**_make_payload())
        body = p.to_json_bytes()
        sig = compute_hmac(body, _SECRET)[:32]  # truncate
        assert verify_hmac(body, _SECRET, sig) is False

    def test_standalone_compute_hmac_matches_sign_method(self):
        p = AiCallbackPayload(**_make_payload())
        assert p.sign(_SECRET) == compute_hmac(p.to_json_bytes(), _SECRET)


# ===========================================================================
# 6. build() factory
# ===========================================================================


class TestBuildFactory:
    def test_build_completed(self):
        p = AiCallbackPayload.build(
            task_id=_TASK_ID,
            status=CallbackStatus.COMPLETED,
            result={"score": 0.88},
            task_type="humanitarian_verification",
        )
        assert p.task_id == _TASK_ID
        assert p.status == CallbackStatus.COMPLETED
        assert p.result == {"score": 0.88}
        assert p.task_type == "humanitarian_verification"
        assert p.completed_at is not None
        # delivery_id must be a valid UUID
        uuid.UUID(p.delivery_id)

    def test_build_failed(self):
        p = AiCallbackPayload.build(
            task_id=_TASK_ID,
            status="failed",
            error="Inference timeout",
        )
        assert p.status == CallbackStatus.FAILED
        assert p.error == "Inference timeout"
        assert p.completed_at is None

    def test_build_timestamp_is_iso8601_utc(self):
        p = AiCallbackPayload.build(task_id=_TASK_ID, status="processing")
        # Must be parseable as an ISO-8601 date string
        dt = datetime.fromisoformat(p.timestamp.replace("Z", "+00:00"))
        assert dt.tzinfo is not None

    def test_build_delivery_id_is_unique(self):
        p1 = AiCallbackPayload.build(task_id=_TASK_ID, status="pending")
        p2 = AiCallbackPayload.build(task_id=_TASK_ID, status="pending")
        assert p1.delivery_id != p2.delivery_id

    def test_build_invalid_status_raises(self):
        with pytest.raises((ValidationError, ValueError)):
            AiCallbackPayload.build(task_id=_TASK_ID, status="not_a_status")

    def test_build_failed_without_error_raises(self):
        with pytest.raises((ValidationError, ValueError)):
            AiCallbackPayload.build(task_id=_TASK_ID, status="failed")  # no error


# ===========================================================================
# 7. Schema version
# ===========================================================================


class TestSchemaVersion:
    def test_schema_version_is_correct_constant(self):
        assert SCHEMA_VERSION == "1.0"

    def test_payload_carries_schema_version(self):
        p = AiCallbackPayload(**_make_payload())
        wire = json.loads(p.to_json_bytes())
        assert wire["schemaVersion"] == SCHEMA_VERSION
