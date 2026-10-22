"""
Fraud detection endpoint.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from schemas.common import ResultEnvelope
from schemas.fraud import ClaimFraudResult, ClaimMetadata, FraudDetectionRequest
from services.decision_audit import get_store as get_decision_audit_store
from services.fraud_detection import FRAUD_RULES_VERSION, detect_fraud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["fraud"])

#: Value written to ``decision_type`` on every audit record from this endpoint.
DECISION_TYPE = "fraud_detection"

#: Value written to ``decision_type`` on every reviewer feedback record.
FEEDBACK_DECISION_TYPE = "fraud_review_feedback"


def _resolve_audit_store(http_request: Request):
    """Resolve the decision audit store (issue #990), app state first."""
    store = getattr(http_request.app.state, "decision_audit_store", None)
    return store if store is not None else get_decision_audit_store()


class FraudReviewFeedbackRequest(BaseModel):
    """A human reviewer's final decision on a previously flagged claim.

    Deliberately carries no claim content: the feedback record references the
    original decision audit entry (by ``audit_id``/``claim_id``) rather than
    duplicating sensitive claim inputs into a second store.
    """

    claim_id: str
    audit_id: Optional[str] = None
    outcome: str  # e.g. "confirmed_fraud" | "false_positive" | "cleared"
    reviewer_id: Optional[str] = None
    notes: Optional[str] = None


class FraudFeedbackReport(BaseModel):
    """Predicted bands vs. actual reviewer outcomes over a rolling window."""

    window_days: int
    generated_at: datetime
    total_feedback: int
    by_predicted_band: Dict[str, Dict[str, int]]
    by_outcome: Dict[str, int]


def _resolve_feedback_store(http_request: Request):
    """Resolve the fraud feedback store, app state first."""
    store = getattr(http_request.app.state, "fraud_feedback_store", None)
    if store is not None:
        return store
    from services.fraud_feedback import get_store as get_fraud_feedback_store

    return get_fraud_feedback_store()


def _lookup_audit_record(http_request: Request, claim_id: str, audit_id: Optional[str]):
    """Fetch the original fraud decision audit record for a claim.

    The feedback record links back to this entry so the score, band and
    inputs stay in the single audited location rather than being copied.
    """
    store = _resolve_audit_store(http_request)
    if store is None:
        return None
    try:
        if audit_id is not None and hasattr(store, "get"):
            return store.get(audit_id)
        if hasattr(store, "find_by_claim"):
            return store.find_by_claim(claim_id, decision_type=DECISION_TYPE)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("decision_audit_lookup_failed: %s", exc)
    return None


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


@router.post("/fraud/feedback", response_model=ResultEnvelope[Dict[str, Any]])
async def submit_fraud_feedback_endpoint(
    http_request: Request,
    feedback: FraudReviewFeedbackRequest,
) -> ResultEnvelope[Dict[str, Any]]:
    """Capture a reviewer's final decision on a flagged claim.

    The feedback record links back to the original fraud decision audit entry
    (issue #990) so the predicted score and band travel with the outcome
    without duplicating sensitive claim content into a second store.
    """
    from main import correlation_id_var

    audit_record = _lookup_audit_record(
        http_request, feedback.claim_id, feedback.audit_id
    )
    if audit_record is None:
        raise HTTPException(
            status_code=404,
            detail="No fraud decision audit record found for claim",
        )

    metadata = getattr(audit_record, "metadata", None) or {}
    predicted_score = metadata.get("fraud_risk_score")
    predicted_band = metadata.get("band") or (
        "flagged" if metadata.get("is_flagged") else "cleared"
    )

    store = _resolve_feedback_store(http_request)
    if store is None:
        logger.warning("fraud_feedback_store_unavailable")
        raise HTTPException(status_code=503, detail="Feedback store unavailable")

    try:
        record = store.record(
            claim_id=feedback.claim_id,
            audit_id=getattr(audit_record, "audit_id", feedback.audit_id),
            outcome=feedback.outcome,
            reviewer_id=feedback.reviewer_id,
            notes=feedback.notes,
            predicted_score=predicted_score,
            predicted_band=predicted_band,
            trace_id=getattr(http_request.state, "correlation_id", "") or None,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("fraud_feedback_record_failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to record feedback") from exc

    return ResultEnvelope[Dict[str, Any]](
        result={
            "claim_id": feedback.claim_id,
            "audit_id": getattr(audit_record, "audit_id", feedback.audit_id),
            "outcome": feedback.outcome,
            "predicted_band": predicted_band,
            "predicted_score": predicted_score,
            "feedback_id": getattr(record, "feedback_id", None),
        },
        trace_id=correlation_id_var.get() or None,
    )


@router.get("/fraud/feedback/report", response_model=ResultEnvelope[FraudFeedbackReport])
async def fraud_feedback_report_endpoint(
    http_request: Request,
    window_days: int = 30,
) -> ResultEnvelope[FraudFeedbackReport]:
    """Compare predicted bands against actual outcomes over a rolling window.

    Distinct from the fixture-based calibration report: this reflects
    real-world reviewer decisions captured via ``/fraud/feedback``.
    """
    from main import correlation_id_var

    store = _resolve_feedback_store(http_request)
    if store is None:
        raise HTTPException(status_code=503, detail="Feedback store unavailable")

    try:
        report = store.build_report(window_days=window_days)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("fraud_feedback_report_failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to build report") from exc

    return ResultEnvelope[FraudFeedbackReport](
        result=FraudFeedbackReport(
            window_days=window_days,
            generated_at=datetime.utcnow(),
            total_feedback=report.get("total_feedback", 0),
            by_predicted_band=report.get("by_predicted_band", {}),
            by_outcome=report.get("by_outcome", {}),
        ),
        trace_id=correlation_id_var.get() or None,
    )
