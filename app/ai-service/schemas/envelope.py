"""
Standardised result envelope – Issue #609.

Every AI endpoint response must carry:

  result          – a concise, domain-specific summary of the AI decision
                    (e.g. "ocr_complete", "real_person", "fraud_detected").
  confidence      – float in [0, 1] representing model certainty.
  reasons         – ordered list of human-readable explanation strings.
  anchor_metadata – arbitrary key/value pairs that let callers correlate the
                    response to their own context (claim_id, image_hash, …).
  trace_id        – UUID-style request identifier for end-to-end tracing.

All fields are Optional so that callers that have not yet migrated continue to
work (no breaking change), while new consumers can rely on the full contract.

Usage
-----
Inherit or compose with ``ResultEnvelope`` and populate the fields inside
each endpoint handler::

    from schemas.envelope import ResultEnvelope

    class OCRResponse(OCRData, ResultEnvelope):
        ...

    # in the route handler:
    return OCRResponse(
        ...
        result="ocr_complete",
        confidence=avg_confidence,
        reasons=["all fields extracted", "high confidence on name"],
        anchor_metadata={"filename": image.filename},
        trace_id=str(uuid.uuid4()),
    )
"""

import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def _new_trace_id() -> str:
    """Generate a fresh UUID4 trace identifier."""
    return str(uuid.uuid4())


class ResultEnvelope(BaseModel):
    """Mixin that adds the standard result envelope fields to any response model."""

    result: Optional[str] = Field(
        default=None,
        description="Concise AI decision label (e.g. 'ocr_complete', 'real_person').",
    )
    confidence: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Model certainty in [0, 1].",
    )
    reasons: Optional[List[str]] = Field(
        default=None,
        description="Ordered list of human-readable explanation strings.",
    )
    anchor_metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Caller-supplied or service-derived key/value context.",
    )
    trace_id: Optional[str] = Field(
        default_factory=_new_trace_id,
        description="UUID-style request identifier for end-to-end tracing.",
    )
