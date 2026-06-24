"""
v1 proof-of-life endpoint.
"""

import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from schemas.envelope import ResultEnvelope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["proof-of-life"])


class ProofOfLifeRequest(BaseModel):
    """Request model for proof-of-life selfie and optional burst frames."""

    selfie_image_base64: str
    burst_images_base64: Optional[List[str]] = None
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ProofOfLifeResponse(ResultEnvelope):
    """
    Proof-of-life analysis response – includes the standardised result envelope (Issue #609).

    Backward-compatible: existing fields (is_real_person, confidence, threshold,
    checks, reason) are preserved alongside the new envelope fields.
    """

    is_real_person: bool
    confidence: float  # overrides Optional[float] from envelope – always present here
    threshold: float
    checks: Dict[str, Any]
    reason: str  # kept for backward compat; also surfaced as reasons[0]


@router.post("/ai/proof-of-life", response_model=ProofOfLifeResponse)
async def analyze_proof_of_life(request: ProofOfLifeRequest):
    """
    Analyse a selfie image (with optional burst frames) for proof-of-life.

    Returns ``is_real_person`` and a confidence score.  When burst frames
    are provided, the service additionally checks for liveness signals
    such as blink detection and head movement.
    """

    import main as _main

    trace_id = str(uuid.uuid4())
    logger.info("Processing proof-of-life verification request")

    try:
        raw = _main.proof_of_life_analyzer.analyze(
            selfie_image_base64=request.selfie_image_base64,
            burst_images_base64=request.burst_images_base64,
            confidence_threshold=request.confidence_threshold,
        )

        # raw may be a dict or a Pydantic model; normalise to dict.
        if isinstance(raw, dict):
            data = raw
        else:
            data = raw.model_dump() if hasattr(raw, "model_dump") else dict(raw)

        is_real = data.get("is_real_person", False)
        reason_str = data.get("reason", "")

        result_label = "real_person" if is_real else "not_real_person"
        reasons = [reason_str] if reason_str else []

        # Strip envelope keys from data so our explicit values take precedence.
        _ENVELOPE_KEYS = {"result", "confidence", "reasons", "anchor_metadata", "trace_id"}
        safe_data = {k: v for k, v in data.items() if k not in _ENVELOPE_KEYS}

        return ProofOfLifeResponse(
            **safe_data,
            # Standard result envelope fields (Issue #609)
            result=result_label,
            # confidence is a required field in ProofOfLifeResponse, already in safe_data
            reasons=reasons or None,
            anchor_metadata={
                "threshold": data.get("threshold"),
                "checks": data.get("checks"),
            },
            trace_id=trace_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Proof-of-life processing failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to process proof-of-life request"
        )
