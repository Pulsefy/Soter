"""
v1 proof-of-life endpoint.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata

logger = logging.getLogger(__name__)

router = APIRouter(tags=["proof-of-life"])


class ProofOfLifeRequest(BaseModel):
    """Request model for proof-of-life selfie and optional burst frames."""

    selfie_image_base64: str = Field(examples=["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="])
    burst_images_base64: Optional[List[str]] = Field(None, examples=[["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="]])
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0, examples=[0.8])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "selfie_image_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    "confidence_threshold": 0.8,
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                }
            ]
        }
    }


class ProofOfLifeResponse(BaseModel):
    """Response model for proof-of-life analysis."""

    is_real_person: bool = Field(examples=[True])
    confidence: float = Field(examples=[0.95])
    threshold: float = Field(examples=[0.8])
    checks: Dict[str, Any] = Field(examples=[{"face_detected": True, "liveness_check": "passed"}])
    reason: str = Field(examples=["Liveness verification passed"])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "is_real_person": True,
                    "confidence": 0.95,
                    "threshold": 0.8,
                    "checks": {"face_detected": True, "liveness_check": "passed"},
                    "reason": "Liveness verification passed",
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                },
                {
                    "is_real_person": False,
                    "confidence": 0.2,
                    "threshold": 0.8,
                    "checks": {"face_detected": False},
                    "reason": "No face detected in image"
                }
            ]
        }
    }


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
        # Ensure we return a ProofOfLifeResponse object with anchor_metadata
        if isinstance(result, dict):
            return ProofOfLifeResponse(
                **result,
                anchor_metadata=request.anchor_metadata
            )
        else:
            # If result is already a BaseModel instance
            result_dict = result.model_dump() if hasattr(result, "model_dump") else result.dict()
            return ProofOfLifeResponse(
                **result_dict,
                anchor_metadata=request.anchor_metadata
            )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Proof-of-life processing failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to process proof-of-life request"
        )
