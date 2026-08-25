"""
Fraud detection endpoint.
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException, Request

from schemas.common import ResultEnvelope
from schemas.fraud import ClaimFraudResult, FraudDetectionRequest
from services.fraud_detection import detect_fraud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fraud"])


@router.post("/fraud/detect", response_model=ResultEnvelope[List[ClaimFraudResult]])
async def detect_fraud_endpoint(
    http_request: Request,
    request: FraudDetectionRequest,
) -> ResultEnvelope[List[ClaimFraudResult]]:
    """
    Analyse a batch of claims for suspicious patterns.

    Returns a ``fraud_risk_score`` (0–1) for each claim.  Claims that are
    statistical outliers relative to the batch are flagged with
    ``is_flagged=true``.
    """
    from main import correlation_id_var

    try:
        results = detect_fraud(request.claims)

        flagged = [r for r in results if r.is_flagged]
        reasons = [
            f"claim_id={r.claim_id}: {r.reason}" for r in flagged if r.reason
        ] or None

        # Aggregate confidence: 1 - mean(fraud_risk_score of flagged claims), or
        # 1 - mean(all scores) as overall cleanliness confidence.
        if results:
            avg_risk = sum(r.fraud_risk_score for r in results) / len(results)
            confidence = round(1.0 - avg_risk, 4)
        else:
            confidence = None

        # Persist a structured decision audit record (inputs, model, outcome)
        # so the reasoning behind this decision can be reconstructed later.
        # Recording must never break the response.
        try:
            audit_store = getattr(http_request.app.state, "decision_audit_store", None)
            if audit_store is not None:
                anchor = request.anchor_metadata
                audit_store.record_decision(
                    trace_id=correlation_id_var.get() or None,
                    decision_type="fraud_detection",
                    provider="local",
                    model="LocalOutlierFactor",
                    prompt_version=None,
                    claim_id=anchor.claim_id if anchor else None,
                    campaign_ref=anchor.campaign_ref if anchor else None,
                    outcome=[
                        {
                            "claim_id": r.claim_id,
                            "fraud_risk_score": r.fraud_risk_score,
                            "is_flagged": r.is_flagged,
                            "code": r.code.value if r.code else None,
                            "reason": r.reason,
                        }
                        for r in results
                    ],
                    confidence=confidence,
                    reasons=reasons,
                    inputs={"claims": [c.model_dump() for c in request.claims]},
                )
        except Exception as exc:
            logger.error("Failed to record decision audit record: %s", exc)

        return ResultEnvelope[List[ClaimFraudResult]](
            result=results,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as exc:
        logger.error("Fraud detection failed: %s", exc)
        raise HTTPException(status_code=500, detail="Fraud detection failed") from exc
