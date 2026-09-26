"""Decision audit query endpoints (issue #990).

Satisfies the "records are queryable by trace id, claim id, and campaign
reference" acceptance criterion: an operator reconstructing why a claim was
rejected weeks later hits ``GET /v1/ai/decision-audit?claim_id=...`` (or by
``trace_id`` / ``campaign_ref``) and gets the inputs, provider, model, prompt
version, outcome, and reasons behind every decision made for that claim.

Records are already redacted at write time (see
``services/decision_audit.py``), so these endpoints expose no raw PII.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from schemas.common import ResultEnvelope
from services.decision_audit import get_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["decision-audit"])

#: Upper bound on how many records one query can return, so a broad query
#: cannot serialise an entire retention window into a single response.
_MAX_LIMIT = 500


def _resolve_store(http_request: Request):
    """Resolve the audit store from app state, falling back to the module store."""
    store = getattr(http_request.app.state, "decision_audit_store", None)
    if store is None:
        store = get_store()
    if store is None:
        raise HTTPException(
            status_code=503, detail="Decision audit store is not configured"
        )
    return store


@router.get(
    "/ai/decision-audit",
    response_model=ResultEnvelope[List[Dict[str, Any]]],
)
async def query_decision_audit(
    http_request: Request,
    trace_id: Optional[str] = Query(
        None, description="Correlation/trace ID echoed on the original response."
    ),
    claim_id: Optional[str] = Query(
        None, description="Claim ID from anchor_metadata or fraud claim metadata."
    ),
    campaign_ref: Optional[str] = Query(
        None, description="Campaign reference from anchor_metadata."
    ),
    decision_type: Optional[str] = Query(
        None,
        description="Filter by decision type, e.g. humanitarian_verification "
        "or fraud_detection.",
    ),
    limit: int = Query(100, ge=1, le=_MAX_LIMIT),
) -> ResultEnvelope[List[Dict[str, Any]]]:
    """Return decision audit records matching the supplied identifiers.

    At least one of ``trace_id``, ``claim_id``, or ``campaign_ref`` is
    required: an unfiltered dump of every decision is neither a useful
    investigation tool nor a safe default. Supplying several narrows the
    result (logical AND). Records come back newest first.
    """
    if not any([trace_id, claim_id, campaign_ref]):
        raise HTTPException(
            status_code=400,
            detail="At least one of trace_id, claim_id, or campaign_ref is required",
        )

    store = _resolve_store(http_request)
    records = store.query(
        trace_id=trace_id,
        claim_id=claim_id,
        campaign_ref=campaign_ref,
        decision_type=decision_type,
        limit=limit,
    )

    return ResultEnvelope[List[Dict[str, Any]]](
        result=[r.to_dict() for r in records],
        confidence=None,
        reasons=None,
        anchor_metadata=None,
        trace_id=getattr(http_request.state, "correlation_id", "") or None,
    )


@router.get(
    "/ai/decision-audit/{record_id}",
    response_model=ResultEnvelope[Dict[str, Any]],
)
async def get_decision_audit_record(
    http_request: Request,
    record_id: str,
) -> ResultEnvelope[Dict[str, Any]]:
    """Return a single decision audit record by its ``record_id``."""
    store = _resolve_store(http_request)
    record = store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit record not found")

    return ResultEnvelope[Dict[str, Any]](
        result=record.to_dict(),
        confidence=None,
        reasons=None,
        anchor_metadata=None,
        trace_id=getattr(http_request.state, "correlation_id", "") or None,
    )
