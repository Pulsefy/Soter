"""
Read-only query endpoint for structured decision audit records.

Records are written by the humanitarian verification and fraud detection
decision endpoints (see ``services/decision_audit.py``) and are queryable here
by trace id, claim id, and campaign reference. All stored fields are redacted
before persistence, so responses never expose raw PII/secrets.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)

router = APIRouter(tags=["audit"])


@router.get("/ai/audit/decisions")
async def list_decision_audits(
    http_request: Request,
    trace_id: Optional[str] = Query(None, description="Filter by trace/correlation id"),
    claim_id: Optional[str] = Query(None, description="Filter by claim id"),
    campaign_ref: Optional[str] = Query(
        None, description="Filter by campaign reference"
    ),
    decision_type: Optional[str] = Query(
        None, description="Filter by decision type (humanitarian_verification | fraud_detection)"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Return structured decision audit records, newest first."""
    store = getattr(http_request.app.state, "decision_audit_store", None)
    if store is None:
        logger.error("decision_audit_store_not_configured")
        raise HTTPException(
            status_code=503,
            detail="Decision audit store is not configured",
        )

    records = store.query(
        trace_id=trace_id,
        claim_id=claim_id,
        campaign_ref=campaign_ref,
        decision_type=decision_type,
        limit=limit,
        offset=offset,
    )
    return {"records": records}
