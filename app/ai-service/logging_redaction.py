"""Guaranteed log redaction for the Soter AI service.

This module provides a dependency-free ``logging.Filter`` that masks
personally identifiable information (PII) and secrets *before* a log record
is emitted, no matter which handler or formatter is attached. It is designed
to sit on the same handler that already emits structured JSON logs in
``main.py`` so that request/response payload logging paths can never leak
sensitive values.

Design goals:

* **No third-party dependencies.** Redaction runs on the logging hot path, so
  it relies only on the standard library (``re`` and ``logging``). The heavier
  spaCy-based scrubber in ``services/pii_scrubber.py`` is intended for request
  *payloads*, not for the synchronous logging path.
* **Fail safe.** The filter never drops a record and never raises; if anything
  goes wrong it falls back to the raw message string.
* **Format agnostic.** Because redaction happens on the ``LogRecord`` itself
  (message, positional args, and any ``extra`` string fields), the output is
  masked whether the handler renders plain text or JSON.
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional, Pattern

__all__ = [
    "REDACTION_PLACEHOLDER",
    "redact",
    "RedactionFilter",
    "install_redaction_filter",
]

#: Text substituted in place of any detected sensitive value.
REDACTION_PLACEHOLDER = "[REDACTED]"


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

# Key/value secrets such as ``api_key=abc123`` or ``"password": "hunter2"``.
# Only the value is masked so the surrounding structure stays readable.
_SECRET_KEY_PATTERN: Pattern[str] = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret"
    r"|secret|password|passwd|pwd|authorization|auth[_-]?token|token)"
    r"(\"?\s*[:=]\s*)(\"?)([^\s\"',}]+)(\"?)"
)


def _redact_secret_kv(match: "re.Match[str]") -> str:
    key, sep, open_quote, _value, close_quote = match.groups()
    return f"{key}{sep}{open_quote}{REDACTION_PLACEHOLDER}{close_quote}"


# Standalone value patterns. Each match is replaced wholesale with the
# placeholder. Order matters: more specific/secret patterns run first so a
# broader pattern cannot partially match a token.
_PATTERNS: List[Pattern[str]] = [
    # Bearer authorization headers.
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"),
    # JSON Web Tokens (header.payload.signature).
    re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"),
    # OpenAI-style secret keys.
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    # Email addresses.
    re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    # US Social Security numbers (3-2-4). The (?<![\w-]) / (?![\w-]) guards
    # stop these numeric patterns from firing inside hyphenated alphanumeric
    # tokens such as UUID correlation IDs or content hashes.
    re.compile(r"(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])"),
    # Grouped 16-digit card numbers (e.g. 4111 1111 1111 1111).
    re.compile(r"(?<![\w-])\d{4}(?:[ \-]?\d{4}){3}(?![\w-])"),
    # American Express style 15-digit cards (4-6-5).
    re.compile(r"(?<![\w-])\d{4}[ \-]?\d{6}[ \-]?\d{5}(?![\w-])"),
    # Phone numbers (optional country code, 3-3-4 core).
    re.compile(
        r"(?<![\w-])(?:\+?\d{1,3}[ .\-]?)?(?:\(\d{3}\)|\d{3})[ .\-]?\d{3}"
        r"[ .\-]?\d{4}(?![\w-])"
    ),
    # IPv4 addresses (strict octets to avoid matching version strings).
    re.compile(
        r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}" r"(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"
    ),
]


def redact(text: str) -> str:
    """Return ``text`` with any detected PII or secrets masked.

    The function is idempotent: redacting already-redacted text is a no-op
    because the placeholder contains no characters that match a pattern.
    """
    if not text:
        return text
    result = _SECRET_KEY_PATTERN.sub(_redact_secret_kv, text)
    for pattern in _PATTERNS:
        result = pattern.sub(REDACTION_PLACEHOLDER, result)
    return result


# Standard ``LogRecord`` attributes that must not be treated as ``extra``
# fields and should never be rewritten by the filter.
_RESERVED_ATTRS = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "message",
        "asctime",
        "taskName",
    }
)


class RedactionFilter(logging.Filter):
    """A ``logging.Filter`` that masks PII/secrets on every record.

    Attach it to a handler (preferred, so it covers every record flowing
    through that handler) or to a logger. It rewrites the fully-rendered
    message and any string values supplied via ``extra=...`` so that the
    emitted output -- plain text or JSON -- is always redacted.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            # Fall back to the raw template if arg interpolation fails; we
            # still redact it and never let the filter break logging.
            message = str(record.msg)

        record.msg = redact(message)
        # Args are already folded into the message above; clearing them
        # prevents a second (now redacted) interpolation pass.
        record.args = None

        for key, value in list(record.__dict__.items()):
            if key in _RESERVED_ATTRS:
                continue
            if isinstance(value, str):
                record.__dict__[key] = redact(value)

        # Never drop a record.
        return True


def install_redaction_filter(
    logger: Optional[logging.Logger] = None,
) -> RedactionFilter:
    """Attach a :class:`RedactionFilter` to every handler on ``logger``.

    Defaults to the root logger. Returns the installed filter so callers can
    reuse or remove it. Attaching to handlers (rather than the logger) ensures
    records propagated from child loggers are also redacted.
    """
    target = logger if logger is not None else logging.getLogger()
    redaction_filter = RedactionFilter()
    for handler in target.handlers:
        handler.addFilter(redaction_filter)
    return redaction_filter
