"""
v1 humanitarian verification endpoint.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from schemas.common import ResultEnvelope
from schemas.humanitarian import (
    HumanitarianVerificationRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])


@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    request: HumanitarianVerificationRequest,
) -> ResultEnvelope[Dict[str, Any]]:
    """Verify an aid claim against standardised humanitarian criteria."""
    import main as _main
    from main import correlation_id_var

    logger.info("Processing humanitarian verification request")

    try:
        try:
            raw = _main.humanitarian_verification_service.verify_claim(
                aid_claim=request.aid_claim,
                supporting_evidence=request.supporting_evidence,
                context_factors=request.context_factors,
                provider_preference=request.provider_preference,
                timeout=request.timeout,
            )
        except TypeError as exc:
            if "timeout" in str(exc):
                raw = _main.humanitarian_verification_service.verify_claim(
                    aid_claim=request.aid_claim,
                    supporting_evidence=request.supporting_evidence,
                    context_factors=request.context_factors,
                    provider_preference=request.provider_preference,
                )
            else:
                raise exc

        verification: Dict[str, Any] = raw.get("verification") or {}

        # Extract confidence and reasons from the LLM-produced verification dict.
        confidence: Optional[float] = None
        raw_conf = verification.get("confidence")
        if isinstance(raw_conf, (int, float)):
            confidence = round(float(max(0.0, min(1.0, raw_conf))), 4)

        reasons: Optional[List[str]] = None
        for key in ("reasoning", "reason", "summary", "explanation"):
            raw_reason = verification.get(key)
            if isinstance(raw_reason, str) and raw_reason:
                reasons = [raw_reason]
                break
            if isinstance(raw_reason, list) and raw_reason:
                reasons = [str(r) for r in raw_reason]
                break

        return ResultEnvelope[Dict[str, Any]](
            result=raw,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        # Re-raise so the global exception handler formats the error envelope
        raise
