"""Tests proving PII/secrets never reach the logs via RedactionFilter."""

import io
import logging
import uuid

import pytest

from logging_redaction import (
    REDACTION_PLACEHOLDER,
    RedactionFilter,
    install_redaction_filter,
    redact,
)

# Representative sensitive values that must never survive redaction.
PII_SAMPLES = {
    "email": "jane.doe@example.com",
    "phone": "+1 (415) 555-0132",
    "ssn": "123-45-6789",
    "credit_card": "4111 1111 1111 1111",
    "amex": "3782 822463 10005",
    "ipv4": "192.168.1.42",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3",
    "openai_key": "sk-abcdefghijklmnopqrstuvwxyz012345",
}


def _make_logger(name):
    """Return an isolated logger writing to an in-memory buffer.

    A RedactionFilter is attached to the handler, mirroring how main.py
    wires the filter onto its stream handler.
    """
    logger = logging.getLogger(name)
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)
    return logger, buffer


@pytest.mark.parametrize("label,value", list(PII_SAMPLES.items()))
def test_redact_masks_each_pii_category(label, value):
    masked = redact(f"payload contains {value} here")
    assert value not in masked, f"{label} leaked: {masked!r}"
    assert REDACTION_PLACEHOLDER in masked


def test_secret_key_value_preserves_key():
    masked = redact('{"password": "hunter2", "api_key": "abc123XYZ"}')
    assert "hunter2" not in masked
    assert "abc123XYZ" not in masked
    # The keys themselves must remain so logs stay diagnosable.
    assert "password" in masked
    assert "api_key" in masked


def test_non_pii_is_preserved():
    line = "GET /api/v1/verify 200 latency=0.0042s version=1.0.0"
    assert redact(line) == line


def test_redact_is_idempotent():
    once = redact("email jane.doe@example.com and ip 10.0.0.7")
    assert redact(once) == once


def test_filter_masks_message_in_captured_logs():
    logger, buffer = _make_logger("soter.redaction.msg")
    logger.info("user login email=jane.doe@example.com ssn 123-45-6789")
    output = buffer.getvalue()
    assert "jane.doe@example.com" not in output
    assert "123-45-6789" not in output
    assert REDACTION_PLACEHOLDER in output


def test_filter_masks_percent_args():
    logger, buffer = _make_logger("soter.redaction.args")
    logger.warning("payment from card %s failed", "4111 1111 1111 1111")
    output = buffer.getvalue()
    assert "4111 1111 1111 1111" not in output
    assert REDACTION_PLACEHOLDER in output


def test_filter_masks_extra_fields():
    logger, buffer = _make_logger("soter.redaction.extra")
    logger.info("request received", extra={"client_ip": "192.168.1.42"})
    # The record attribute itself is redacted, so any formatter that emits
    # extra fields (e.g. JSON) is also safe.
    output = buffer.getvalue()
    assert "192.168.1.42" not in output


def test_filter_never_drops_records():
    logger, buffer = _make_logger("soter.redaction.keep")
    logger.info("nothing sensitive here")
    assert "nothing sensitive here" in buffer.getvalue()


def test_no_pii_sample_survives_full_pipeline():
    logger, buffer = _make_logger("soter.redaction.sweep")
    for value in PII_SAMPLES.values():
        logger.info("field=%s", value)
    output = buffer.getvalue()
    for value in PII_SAMPLES.values():
        assert value not in output, f"leaked: {value!r}"


# Digit-heavy UUIDs that must never be clipped by the numeric patterns.
CORRELATION_IDS = [
    "12345678-9012-3456-7890-123456789012",
    "00000000-0000-0000-0000-000000000000",
    "a1b2c3d4-5678-90ab-cdef-1234567890ab",
]


@pytest.mark.parametrize("correlation_id", CORRELATION_IDS)
def test_correlation_id_is_not_mangled(correlation_id):
    # UUID correlation IDs must be preserved for traceability.
    assert redact(correlation_id) == correlation_id


def test_random_correlation_ids_survive():
    for _ in range(200):
        correlation_id = str(uuid.uuid4())
        assert redact(correlation_id) == correlation_id


def test_install_redaction_filter_attaches_to_handlers():
    logger = logging.getLogger("soter.redaction.install")
    logger.handlers.clear()
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    logger.addHandler(handler)
    installed = install_redaction_filter(logger)
    assert isinstance(installed, RedactionFilter)
    assert installed in handler.filters
