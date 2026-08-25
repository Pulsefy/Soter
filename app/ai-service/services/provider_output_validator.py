"""Provider output validation, refusal detection, and bounded repair logic.

This module is the single authority for turning a raw LLM response string into
a validated ``dict`` that matches the expected output schema.  It handles the
four most common real-world failure modes:

1. **Valid JSON** — passes schema validation and is returned immediately.
2. **Markdown-fenced JSON** — the ```json ... ``` wrapper is stripped, then
   the content is re-validated.
3. **Truncated JSON** — a best-effort bracket-balance repair is attempted
   before validation.
4. **Provider refusals / prose** — patterns such as "I cannot help" or
   "I'm sorry" are detected and raised as ``ProviderRefusalError`` instead of
   an opaque parse error.

Any output that still fails validation after the repair attempt raises
``ProviderOutputError``, carrying the raw content and the attempt count so
callers can decide whether to retry with a different provider.

Typical call site usage (see ``HumanitarianVerificationService``)::

    from services.provider_output_validator import ProviderOutputValidator

    validator = ProviderOutputValidator(
        required_keys={"verdict", "confidence", "summary"},
        max_repair_attempts=2,
    )
    parsed = validator.validate(raw_content)   # raises on persistent failure
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, FrozenSet, Optional, Set

from exceptions import ProviderOutputError, ProviderRefusalError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Refusal detection — ordered from most to least specific
# ---------------------------------------------------------------------------

# Phrases that indicate the model refused the request rather than producing
# output.  Patterns use re.IGNORECASE so they work on both original and
# lower-cased text.
_F = re.IGNORECASE  # shorthand used below

_REFUSAL_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Explicit policy / safety blocks
    (re.compile(r"\bcannot\s+(?:help|assist|provide|fulfill|complete)\b", _F), "content_policy"),
    (re.compile(r"\bI(?:'m|\s+am)\s+(?:unable|not\s+able)\s+to\b", _F), "content_policy"),
    (re.compile(r"\bviolates?\s+(?:my\s+)?(?:content\s+)?(?:policy|guidelines|terms)\b", _F), "content_policy"),
    (re.compile(r"\bsafety\s+(?:filter|policy|guidelines)\b", _F), "safety_filter"),
    (re.compile(r"\bnot\s+(?:appropriate|allowed|permitted)\b", _F), "content_policy"),
    # Apology-then-decline constructions
    (re.compile(r"\bI(?:'m|\s+am)\s+sorry[,.]?\s+(?:but\s+)?I\s+(?:can(?:'t|not)|won't|will\s+not)\b", _F), "content_policy"),
    (re.compile(r"\bI\s+(?:can(?:'t|not)|won't|will\s+not)\s+(?:help|assist|do|provide)\b", _F), "content_policy"),
    # Model expressing inability without JSON
    (re.compile(r"\bAs\s+an\s+AI\b.*?\bI\s+(?:can(?:'t|not)|cannot)\b", _F), "content_policy"),
]

# Minimum character length below which a response that contains no JSON
# structure at all is treated as a refusal placeholder.
_MIN_CONTENT_LENGTH_FOR_JSON = 2

# ---------------------------------------------------------------------------
# Required keys for each supported output variant
# ---------------------------------------------------------------------------

#: Minimum keys required in a primary (full) humanitarian verification response.
HUMANITARIAN_PRIMARY_KEYS: FrozenSet[str] = frozenset(
    {"verdict", "confidence", "summary"}
)

#: Minimum keys required in a fallback humanitarian verification response.
HUMANITARIAN_FALLBACK_KEYS: FrozenSet[str] = frozenset(
    {"verdict", "confidence", "summary"}
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _strip_markdown_fence(text: str) -> str:
    """Remove leading/trailing markdown code fences from *text*.

    Handles both ````json`` and plain ```` variants.
    """
    stripped = text.strip()
    # Remove opening fence (```json or ```)
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped, flags=re.IGNORECASE)
    # Remove closing fence
    stripped = re.sub(r"\n?```\s*$", "", stripped)
    return stripped.strip()


def _repair_truncated_json(text: str) -> str:
    """Attempt to close unclosed JSON brackets/braces in *text*.

    This is a heuristic: it counts unmatched ``{`` / ``[`` openers and
    appends the corresponding closers.  It handles the most common
    truncation case (response cut off mid-object) but is not a full
    JSON parser.

    Returns the (possibly repaired) string; does *not* guarantee valid JSON.
    """
    open_chars = {"{": "}", "[": "]"}
    close_chars = set(open_chars.values())

    stack: list[str] = []
    in_string = False
    escape_next = False

    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in open_chars:
            stack.append(open_chars[ch])
        elif ch in close_chars:
            if stack and stack[-1] == ch:
                stack.pop()

    if not stack:
        return text

    # Close any trailing comma before appending closers, which is another
    # common truncation artefact (last key-value pair ends with ", ...")
    repaired = text.rstrip()
    if repaired.endswith(","):
        repaired = repaired[:-1]

    # Append missing closers in reverse stack order
    repaired += "".join(reversed(stack))
    return repaired


def _detect_refusal(text: str) -> Optional[str]:
    """Return a refusal reason string if *text* looks like a refusal, else None."""
    for pattern, reason in _REFUSAL_PATTERNS:
        if pattern.search(text):
            return reason
    return None


def _looks_like_prose(text: str) -> bool:
    """Return True when *text* contains no JSON structure at all."""
    stripped = text.strip()
    return not stripped.startswith(("{", "[", "`"))


# ---------------------------------------------------------------------------
# Public validator
# ---------------------------------------------------------------------------


class ProviderOutputValidator:
    """Validate and repair a raw LLM response string.

    Parameters
    ----------
    required_keys:
        Set of top-level keys that must be present in the parsed dict.
        Defaults to ``HUMANITARIAN_PRIMARY_KEYS``.
    max_repair_attempts:
        Maximum number of parse-and-repair cycles before giving up.
        Must be >= 1.  Defaults to 2.
    """

    def __init__(
        self,
        required_keys: Optional[Set[str]] = None,
        max_repair_attempts: int = 2,
    ) -> None:
        if max_repair_attempts < 1:
            raise ValueError("max_repair_attempts must be >= 1")
        self.required_keys: FrozenSet[str] = frozenset(
            required_keys if required_keys is not None else HUMANITARIAN_PRIMARY_KEYS
        )
        self.max_repair_attempts = max_repair_attempts

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def validate(self, raw_content: str) -> Dict[str, Any]:
        """Parse, validate, and optionally repair *raw_content*.

        Returns a ``dict`` that passes schema validation.

        Raises
        ------
        ProviderRefusalError
            If the response matches a known refusal pattern.
        ProviderOutputError
            If the response cannot be parsed or validated after all repair
            attempts are exhausted.
        """
        if not raw_content or not raw_content.strip():
            raise ProviderOutputError(
                message="Provider returned empty content",
                raw_content=raw_content,
                attempts=1,
            )

        # Refusal check before any JSON work — refusals are prose and the
        # right action is different from parse errors.
        refusal_reason = _detect_refusal(raw_content)
        if refusal_reason:
            raise ProviderRefusalError(
                message="Provider refused to fulfil the request",
                raw_content=raw_content,
                refusal_reason=refusal_reason,
            )

        # Also check for pure prose with no JSON structure
        if _looks_like_prose(raw_content):
            # One last refusal heuristic: short/generic prose
            raise ProviderOutputError(
                message="Provider returned prose instead of JSON",
                raw_content=raw_content,
                attempts=1,
            )

        last_exc: Exception = RuntimeError("unknown error")
        candidate = raw_content

        for attempt in range(1, self.max_repair_attempts + 1):
            try:
                parsed = self._parse_and_validate(candidate, attempt)
                if attempt > 1:
                    logger.info(
                        "Provider output repaired successfully on attempt %d", attempt
                    )
                return parsed
            except (json.JSONDecodeError, ValueError) as exc:
                last_exc = exc
                logger.debug(
                    "Parse/validate failed on attempt %d: %s", attempt, exc
                )
                if attempt < self.max_repair_attempts:
                    candidate = self._repair(candidate, attempt)

        raise ProviderOutputError(
            message=f"Provider output failed validation after {self.max_repair_attempts} attempt(s): {last_exc}",
            raw_content=raw_content,
            attempts=self.max_repair_attempts,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _parse_and_validate(self, text: str, attempt: int) -> Dict[str, Any]:
        """Strip fences, parse JSON, and check required keys."""
        # Strip markdown code fences (e.g., ```json ... ```)
        cleaned = _strip_markdown_fence(text)

        parsed: Any = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError(
                f"Provider response must be a JSON object, got {type(parsed).__name__}"
            )

        missing = self.required_keys - parsed.keys()
        if missing:
            raise ValueError(
                f"Provider response missing required keys: {sorted(missing)}"
            )

        return parsed

    def _repair(self, text: str, attempt: int) -> str:
        """Apply repair heuristics to *text* and return the repaired string."""
        logger.debug("Attempting JSON repair (attempt=%d)", attempt)
        # Strip fences first so the bracket balancer sees raw JSON
        defenced = _strip_markdown_fence(text)
        return _repair_truncated_json(defenced)
