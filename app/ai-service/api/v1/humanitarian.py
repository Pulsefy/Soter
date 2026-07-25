"""
v1 humanitarian verification endpoint.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from config import settings
from schemas.common import ResultEnvelope
from schemas.humanitarian import (
    HumanitarianVerificationRequest,
)
from services.cache import cached_response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])


@cached_response(
    prefix="humanitarian_verification",
    ttl_seconds=settings.cache_ttl_verification,
    key_tags=["model_version", "artifact_tag"],
)
async def _verify_claim_cached(
    aid_claim: str,
    supporting_evidence: List[str],
    context_factors: Dict[str, Any],
    provider_preference: str,
    timeout: Optional[float],
    model_version: str,
    artifact_tag: str,
) -> Dict[str, Any]:
    """
    Cacheable wrapper around HumanitarianVerificationService.verify_claim.

    `model_version` and `artifact_tag` don't affect the underlying provider
    call, but embedding them in the cache key ensures a stale response isn't
    served after the configured model/provider changes, or after an evidence
    artifact referenced by the claim is updated (see
    CacheInvalidationHelper.invalidate_verification_by_artifact/_model_version).
    """
    import main as _main

    try:
        return _main.humanitarian_verification_service.verify_claim(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
            provider_preference=provider_preference,
            timeout=timeout,
        )
    except TypeError as exc:
        if "timeout" in str(exc):
            return _main.humanitarian_verification_service.verify_claim(
                aid_claim=aid_claim,
                supporting_evidence=supporting_evidence,
                context_factors=context_factors,
                provider_preference=provider_preference,
            )
        raise


@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    request: HumanitarianVerificationRequest,
) -> ResultEnvelope[Dict[str, Any]]:
    """Verify an aid claim against standardised humanitarian criteria."""
    import main as _main
    from main import correlation_id_var

    logger.info("Processing humanitarian verification request")

    try:
        model_version = _main.humanitarian_verification_service.get_model_version(
            request.provider_preference
        )
        artifact_tag = ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""

        raw = await _verify_claim_cached(
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
            timeout=request.timeout,
            model_version=model_version,
            artifact_tag=artifact_tag,
        )

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
