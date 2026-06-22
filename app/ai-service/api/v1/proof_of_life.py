"""
v1 proof-of-life endpoint.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["proof-of-life"])


class ProofOfLifeRequest(BaseModel):
    """Request model for proof-of-life selfie and optional burst frames."""

    selfie_image_base64: str
    burst_images_base64: Optional[List[str]] = None
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ProofOfLifeResponse(BaseModel):
    """Response model for proof-of-life analysis."""

    is_real_person: bool
    confidence: float
    threshold: float
    checks: Dict[str, Any]
    reason: str


@router.post("/ai/proof-of-life", response_model=ProofOfLifeResponse)
async def analyze_proof_of_life(request: ProofOfLifeRequest):
    """
    Analyse a selfie image (with optional burst frames) for proof-of-life.

    Returns ``is_real_person`` and a confidence score.  When burst frames
    are provided, the service additionally checks for liveness signals
    such as blink detection and head movement.
    """

    import main as _main

    logger.info("Processing proof-of-life verification request")

    try:
        result = _main.proof_of_life_analyzer.analyze(
            selfie_image_base64=request.selfie_image_base64,
            burst_images_base64=request.burst_images_base64,
            confidence_threshold=request.confidence_threshold,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Proof-of-life processing failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to process proof-of-life request"
        )
