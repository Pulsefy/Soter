"""Confidence banding and manual-review routing for OCR results (issue #984).

``services/ocr.py`` returns extracted text and a per-field confidence, but
until now a shaky extraction was indistinguishable from a confident one:
the backend treated every result as authoritative.  This module turns the
field confidences into a single aggregate score, bands it with configurable
thresholds, and decides whether a human should review the document.

The thresholds live in :class:`config.Settings` so operators can retune
sensitivity without a code change:

* ``ocr_confidence_review_threshold`` - at or below this score the result
  is flagged for review (band ``low``).
* ``ocr_confidence_high_threshold`` - scores at or above this are band
  ``high``; scores in between are ``medium``.
* ``ocr_confidence_thresholds_by_document_type`` - optional per-document
  overrides for the review threshold (e.g. an ID card needs a higher bar
  than a hand-written receipt).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, List, Optional

from config import Settings, get_settings
from schemas.ocr import OCRConfidenceBand

#: Reason recorded when the extraction carried no confidence at all.
REASON_MISSING_CONFIDENCE = "missing_confidence"
#: Reason recorded when the aggregate score is below the review threshold.
REASON_BELOW_THRESHOLD = "below_confidence_threshold"


@dataclass(frozen=True)
class ConfidenceAssessment:
    """Outcome of banding an OCR result against the configured thresholds."""

    confidence: Optional[float]
    band: OCRConfidenceBand
    needs_review: bool
    review_threshold: float
    reasons: List[str] = field(default_factory=list)


def aggregate_confidence(
    confidences: Iterable[Optional[float]],
) -> Optional[float]:
    """Mean of the available confidences, or ``None`` when there are none.

    Missing (``None``) entries are ignored rather than counted as zero, so a
    single field without a confidence does not drag a confident document
    below the threshold.  An empty input - or one where every confidence is
    missing - returns ``None`` to signal "unknown", not "unreliable".
    """
    values = [float(value) for value in confidences if value is not None]
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def resolve_review_threshold(
    document_type: Optional[str],
    settings: Optional[Settings] = None,
) -> float:
    """Return the review threshold for *document_type*.

    A matching per-document-type override wins; otherwise the global
    ``ocr_confidence_review_threshold`` applies.  Lookups are case- and
    whitespace-insensitive so callers need not normalise the value.
    """
    active = settings or get_settings()
    if document_type:
        key = str(document_type).strip().lower()
        override = active.ocr_confidence_thresholds_by_document_type.get(key)
        if override is not None:
            return float(override)
    return float(active.ocr_confidence_review_threshold)


def assess_confidence(
    confidences: Iterable[Optional[float]],
    *,
    document_type: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> ConfidenceAssessment:
    """Band an OCR result and decide whether it needs manual review.

    Missing confidence always routes to review: unlike a genuinely low score,
    an absent score gives the backend nothing to reason about, so the safe
    default is a human look.
    """
    active = settings or get_settings()
    review_threshold = resolve_review_threshold(document_type, active)
    high_threshold = float(active.ocr_confidence_high_threshold)
    confidence = aggregate_confidence(confidences)

    if confidence is None:
        return ConfidenceAssessment(
            confidence=None,
            band=OCRConfidenceBand.low,
            needs_review=True,
            review_threshold=review_threshold,
            reasons=[REASON_MISSING_CONFIDENCE],
        )
    if confidence < review_threshold:
        return ConfidenceAssessment(
            confidence=confidence,
            band=OCRConfidenceBand.low,
            needs_review=True,
            review_threshold=review_threshold,
            reasons=[REASON_BELOW_THRESHOLD],
        )
    if confidence < high_threshold:
        return ConfidenceAssessment(
            confidence=confidence,
            band=OCRConfidenceBand.medium,
            needs_review=False,
            review_threshold=review_threshold,
            reasons=[],
        )
    return ConfidenceAssessment(
        confidence=confidence,
        band=OCRConfidenceBand.high,
        needs_review=False,
        review_threshold=review_threshold,
        reasons=[],
    )
