"""
Fraud detection endpoint.
"""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

from schemas.common import ResultEnvelope
from schemas.fraud import ClaimFraudResult, ClaimMetadata, FraudDetectionRequest
from services.decision_audit import get_store as get_decision_audit_store
from services.fraud_detection import FRAUD_RULES_VERSION, detect_fraud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fraud"])

#: Value written to ``decision_type`` on every audit record from this endpoint.
DECISION_TYPE = "fraud_detection"


def _resolve_audit_store(http_request: Request):
    """Resolve the decision audit store (issue #990), app state first."""
    store = getattr(http_request.app.state, "decision_audit_store", None)
    return store if store is not None else get_decision_audit_store()


def _claim_inputs(claim: ClaimMetadata) -> Dict[str, Any]:
    """The per-claim inputs the risk score was computed from.

    Captured verbatim; the store redacts them per ``logging_redaction.py``
    before writing, which is what masks the IP address here.
    """
    return {
        "claim_id": claim.claim_id,
        "ip_address": claim.ip_address,
        "evidence_hash": claim.evidence_hash,
        "amount": claim.amount,
        "location": claim.location,
        "extra": dict(claim.extra),
    }


def _write_audit_records(
    http_request: Request,
    request: FraudDetectionRequest,
    results: List[ClaimFraudResult],
) -> None:
    """Write one audit record per scored claim (issue #990).

    Fraud scoring is a batch operation but each claim gets its own decision,
    so each claim gets its own record - that is what makes the trail queryable
    by ``claim_id``. ``FRAUD_RULES_VERSION`` stands in for the prompt version:
    this decision is statistical rather than prompt-driven, and the rules
    version is the equivalent handle on "what logic produced this score".
    """
    store = _resolve_audit_store(http_request)
    if store is None:
        logger.warning("decision_audit_store_unavailable")
        return

    anchor = request.anchor_metadata
    correlation_id = getattr(http_request.state, "correlation_id", "") or None
    by_claim_id = {c.claim_id: c for c in request.claims}
    batch_size = len(results)

    for result in results:
        claim = by_claim_id.get(result.claim_id)
        try:
            store.record(
                DECISION_TYPE,
                "flagged" if result.is_flagged else "cleared",
                trace_id=correlation_id,
                # The batch's own claim_id is the primary query handle; the
                # anchor claim_id (if any) is kept in metadata so a batch
                # submitted under one anchor stays traceable both ways.
                claim_id=result.claim_id,
                campaign_ref=getattr(anchor, "campaign_ref", None),
                package_id=getattr(anchor, "package_id", None),
                provider="internal",
                model="sklearn.LocalOutlierFactor",
                prompt_version=FRAUD_RULES_VERSION,
                confidence=(
                    round(1.0 - result.fraud_risk_score, 4)
                    if result.fraud_risk_score is not None
                    else None
                ),
                reasons=[result.reason] if result.reason else [],
                inputs=_claim_inputs(claim) if claim is not None else {},
                metadata={
                    "fraud_risk_score": result.fraud_risk_score,
                    "is_flagged": result.is_flagged,
                    "code": result.code.value if result.code else None,
                    "batch_size": batch_size,
                    "anchor_claim_id": getattr(anchor, "claim_id", None),
                },
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("decision_audit_record_failed: %s", exc)


def _write_failure_audit(
    http_request: Request,
    request: FraudDetectionRequest,
    error: Exception,
) -> None:
    """Record that a fraud decision could not be produced (issue #990)."""
    store = _resolve_audit_store(http_request)
    if store is None:
        return
    anchor = request.anchor_metadata
    try:
        store.record(
            DECISION_TYPE,
            "error",
            trace_id=getattr(http_request.state, "correlation_id", "") or None,
            claim_id=getattr(anchor, "claim_id", None),
            campaign_ref=getattr(anchor, "campaign_ref", None),
            package_id=getattr(anchor, "package_id", None),
            provider="internal",
            model="sklearn.LocalOutlierFactor",
            prompt_version=FRAUD_RULES_VERSION,
            reasons=[str(error)],
            inputs={"claims": [_claim_inputs(c) for c in request.claims]},
            metadata={"error_type": type(error).__name__},
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("decision_audit_record_failed: %s", exc)


@router.post("/fraud/detect", response_model=ResultEnvelope[List[ClaimFraudResult]])
async def detect_fraud_endpoint(
    http_request: Request,
    request: FraudDetectionRequest,
) -> ResultEnvelope[List[ClaimFraudResult]]:
    """
    Analyse a batch of claims for suspicious patterns.

    Returns a ``fraud_risk_score`` (0-1) for each claim.  Claims that are
    statistical outliers relative to the batch are flagged with
    ``is_flagged=true``.

    Every scored claim also produces a durable decision audit record (issue
    #990) so the score can be explained after the fact; see
    ``services/decision_audit.py``.
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

        # Audit before returning: the record is the reason the disbursement
        # decision can be reconstructed later.
        _write_audit_records(http_request, request, results)

        return ResultEnvelope[List[ClaimFraudResult]](
            result=results,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as exc:
        logger.error("Fraud detection failed: %s", exc)
        _write_failure_audit(http_request, request, exc)
        raise HTTPException(status_code=500, detail="Fraud detection failed") from exc
