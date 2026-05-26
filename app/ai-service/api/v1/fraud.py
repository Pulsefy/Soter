"""
Fraud detection endpoint.
"""

import logging
import time

from fastapi import APIRouter, HTTPException

from schemas.fraud import FraudDetectionRequest, FraudDetectionResponse
from schemas.metadata import VerificationMetadata
from services.fraud_detection import detect_fraud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fraud"])


@router.post("/fraud/detect", response_model=FraudDetectionResponse)
async def detect_fraud_endpoint(request: FraudDetectionRequest) -> FraudDetectionResponse:
    """
    Analyse a batch of claims for suspicious patterns.

    Returns a ``fraud_risk_score`` (0–1) for each claim.  Claims that are
    statistical outliers relative to the batch are flagged with
    ``is_flagged=true``.
    """
    try:
        results = detect_fraud(request.claims)
        
        # Create verification metadata if campaign_id is provided
        verification_metadata = None
        if request.campaign_id:
            verification_metadata = VerificationMetadata(
                campaign_id=request.campaign_id,
                claim_id=f"fraud_batch_{int(time.time())}",
                verification_timestamp=int(time.time()),
            )
        
        return FraudDetectionResponse(
            results=results,
            flagged_count=sum(r.is_flagged for r in results),
            verification_metadata=verification_metadata,
        )
    except Exception as exc:
        logger.error("Fraud detection failed: %s", exc)
        raise HTTPException(status_code=500, detail="Fraud detection failed") from exc
