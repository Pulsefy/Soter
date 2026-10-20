"""Derive a short human-readable explanation for a verification confidence score.

A bare number such as ``0.42`` tells a reviewer nothing about which parts of
the claim pushed it down. Whenever the model's own reasoning output carries
structured factors -- an explicit ``confidence_factors`` list, a
``criteria_assessment`` breakdown, or uncertainty flags -- those are surfaced
as the top contributing factors alongside the score.

Responses that carry none of those signals (a provider that returned only
``verdict``/``confidence``/``summary``, a deterministic stub, a model that
ignored the requested schema) yield no explanation at all: callers omit the
field rather than fabricating one.
"""

from typing import Any, Dict, List, Optional, Tuple

#: Maximum number of factors surfaced on a response; the list is meant to be
#: scanned in a glance, not to be a transcript of the model's reasoning.
MAX_CONFIDENCE_FACTORS = 3

#: Longest text kept per factor so a verbose model cannot turn the
#: "short list" into a paragraph.
MAX_FACTOR_LENGTH = 200

#: Criteria statuses ordered by how much they depressed the score; the
#: strongest downward drivers are surfaced first. Unrecognised statuses sort
#: with the uncertainty bucket rather than being dropped.
_STATUS_PRIORITY = {"not_met": 0, "partially_met": 1, "unknown": 2, "met": 3}


def _clean(value: Any) -> Optional[str]:
    """Return *value* stripped of surrounding whitespace, or ``None``."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _trim(value: str) -> str:
    if len(value) <= MAX_FACTOR_LENGTH:
        return value
    return value[: MAX_FACTOR_LENGTH - 1].rstrip() + "…"


def _string_list(value: Any) -> List[str]:
    """Normalize a list of model-produced strings, dropping unusable entries."""
    if not isinstance(value, list):
        return []
    factors = []
    for item in value:
        factor = _clean(item)
        if factor is not None:
            factors.append(_trim(factor))
    return factors


def _from_confidence_factors(verification: Dict[str, Any]) -> List[str]:
    """Explicit ``confidence_factors`` list emitted by the model, if any."""
    raw = verification.get("confidence_factors")
    if not isinstance(raw, list):
        return []

    factors: List[str] = []
    for item in raw:
        if isinstance(item, str):
            factor = _clean(item)
            if factor:
                factors.append(_trim(factor))
        elif isinstance(item, dict):
            label = None
            for key in ("factor", "name", "criterion"):
                label = _clean(item.get(key))
                if label:
                    break
            if not label:
                continue
            impact = None
            for key in ("impact", "direction", "contribution"):
                impact = _clean(item.get(key))
                if impact:
                    break
            text = f"{label} ({impact})" if impact else label
            factors.append(_trim(text))
    return factors


def _from_criteria_assessment(verification: Dict[str, Any]) -> List[str]:
    """Per-criterion statuses, ordered so the score's biggest drags lead."""
    raw = verification.get("criteria_assessment")
    if not isinstance(raw, list):
        return []

    ranked: List[Tuple[int, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        criterion = None
        for key in ("criterion", "name"):
            criterion = _clean(item.get(key))
            if criterion:
                break
        if not criterion:
            continue
        status = _clean(item.get("status"))
        if status:
            text = f"{criterion}: {status}"
            reason = _clean(item.get("reason"))
            if reason:
                text = f"{text} — {reason}"
        else:
            text = criterion
        priority = _STATUS_PRIORITY.get(status.lower(), 2) if status else 2
        ranked.append((priority, _trim(text)))

    ranked.sort(key=lambda entry: entry[0])
    return [text for _, text in ranked]


def _from_uncertainty_flags(verification: Dict[str, Any]) -> List[str]:
    """``risk_flags`` / ``missing_information`` -- the model's stated drags."""
    factors = [
        f"Risk flag: {item}" for item in _string_list(verification.get("risk_flags"))
    ]
    factors += [
        f"Missing information: {item}"
        for item in _string_list(verification.get("missing_information"))
    ]
    return factors


def _from_list_reasoning(verification: Dict[str, Any]) -> List[str]:
    """List-form ``reasoning``/``explanation`` -- factors the model wrote out.

    A prose (string) rationale is deliberately not split into factors: cutting
    a sentence into pieces would be fabricating structure the model never
    provided.
    """
    for key in ("reasoning", "explanation", "reason"):
        factors = _string_list(verification.get(key))
        if factors:
            return factors
    return []


#: Derivation sources in priority order -- the most score-specific signal
#: available on the response wins.
_SOURCES = (
    _from_confidence_factors,
    _from_criteria_assessment,
    _from_uncertainty_flags,
    _from_list_reasoning,
)


def derive_confidence_explanation(verification: Any) -> Optional[List[str]]:
    """Return the top factors contributing to ``verification``'s confidence score.

    ``verification`` is the parsed JSON the model returned. Returns ``None``
    when the response carries no structured reasoning to derive factors from,
    so the caller can omit the field instead of inventing an explanation.
    """
    if not isinstance(verification, dict):
        return None

    for source in _SOURCES:
        factors = source(verification)
        if factors:
            return factors[:MAX_CONFIDENCE_FACTORS]
    return None
