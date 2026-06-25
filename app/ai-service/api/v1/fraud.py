"""
Fraud detection endpoint.
"""

import logging
import uuid

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
    trace_id = str(uuid.uuid4())

    try:
        results = detect_fraud(request.claims)
        flagged_count = sum(r.is_flagged for r in results)

        # Derive top-level confidence as 1 - mean fraud risk score (ensemble certainty).
        if results:
            mean_risk = sum(r.fraud_risk_score for r in results) / len(results)
            confidence = round(1.0 - mean_risk, 4)
        else:
            confidence = None

        result_label = "fraud_detected" if flagged_count > 0 else "no_fraud_detected"

        reasons: list[str] = [f"Analysed {len(results)} claim(s)"]
        if flagged_count:
            reasons.append(f"{flagged_count} claim(s) flagged as suspicious")
            flagged_ids = [r.claim_id for r in results if r.is_flagged]
            if flagged_ids:
                reasons.append(f"Flagged claim IDs: {', '.join(flagged_ids)}")
        else:
            reasons.append("No suspicious patterns detected")

        return FraudDetectionResponse(
            results=results,
            flagged_count=flagged_count,
            # Standard result envelope fields (Issue #609)
            result=result_label,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata={
                "total_claims": len(results),
                "flagged_count": flagged_count,
            },
            trace_id=trace_id,
            flagged_count=sum(r.is_flagged for r in results),
            anchor_metadata=request.anchor_metadata
        )
    except Exception as exc:
        logger.error("Fraud detection failed: %s", exc)
        raise HTTPException(status_code=500, detail="Fraud detection failed") from exc
