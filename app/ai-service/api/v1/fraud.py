"""
Fraud detection endpoint.
"""

import logging

from fastapi import APIRouter, HTTPException

from schemas.fraud import FraudDetectionRequest, FraudDetectionResponse
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
        return FraudDetectionResponse(
            results=results,
            flagged_count=sum(r.is_flagged for r in results),
        )
    except Exception as exc:
        logger.error("Fraud detection failed: %s", exc)
        raise HTTPException(status_code=500, detail="Fraud detection failed") from exc
