"""
Fraud detection endpoint.

Threshold configuration
-----------------------
Active thresholds are read from config.Settings at request time:

  FRAUD_REVIEW_THRESHOLD   (default 0.40)
  FRAUD_REJECT_THRESHOLD   (default 0.75)
  FRAUD_LOF_OUTLIER_THRESHOLD  (default -1.5)

The banding applied to each claim (pass / review / reject) is included in
every ``ClaimFraudResult`` alongside the raw ``fraud_risk_score``.

Every batch emits a ``fraud_decision_audit`` structured log entry that records
the active threshold snapshot so that threshold changes can be traced.
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException

from config import settings
from schemas.common import ResultEnvelope
from schemas.fraud import ClaimFraudResult, FraudDetectionRequest
from services.fraud_detection import detect_fraud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fraud"])


@router.post("/fraud/detect", response_model=ResultEnvelope[List[ClaimFraudResult]])
async def detect_fraud_endpoint(
    request: FraudDetectionRequest,
) -> ResultEnvelope[List[ClaimFraudResult]]:
    """
    Analyse a batch of claims for suspicious patterns.

    Returns a ``fraud_risk_score`` (0–1) and a ``band`` (pass / review / reject)
    for each claim.  Claims that are statistical outliers relative to the batch
    are flagged with ``is_flagged=true``.

    **Band thresholds** (configurable via environment variables):
    - ``pass``   : score < ``FRAUD_REVIEW_THRESHOLD`` (default 0.40)
    - ``review`` : ``FRAUD_REVIEW_THRESHOLD`` ≤ score < ``FRAUD_REJECT_THRESHOLD`` (default 0.75)
    - ``reject`` : score ≥ ``FRAUD_REJECT_THRESHOLD`` (default 0.75)

    A ``fraud_decision_audit`` log entry is written for every request, recording
    the active threshold values alongside every per-claim decision so that
    historical reviews remain accurate even after operator threshold changes.
    """
    from main import correlation_id_var

    try:
        results = detect_fraud(request.claims)

        flagged = [r for r in results if r.is_flagged]
        reasons = (
            [f"claim_id={r.claim_id}: {r.reason}" for r in flagged if r.reason] or None
        )

        # Aggregate confidence: 1 - mean(fraud_risk_score) as overall cleanliness signal.
        if results:
            avg_risk = sum(r.fraud_risk_score for r in results) / len(results)
            confidence = round(1.0 - avg_risk, 4)
        else:
            confidence = None

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
