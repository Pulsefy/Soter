"""
v1 humanitarian verification endpoint.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, Request

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
    key_tags=["model_version", "artifact_tag", "org_id", "prompt_version", "language"],
    content_hash_arg="content_hash",
)
async def _verify_claim_cached(
    humanitarian_verification_service,
    aid_claim: str,
    supporting_evidence: List[str],
    context_factors: Dict[str, Any],
    provider_preference: str,
    timeout: Optional[float],
    model_version: str,
    artifact_tag: str,
    org_id: str,
    prompt_version: str = "",
    content_hash: str = "",
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Cacheable wrapper around HumanitarianVerificationService.verify_claim.

    ``model_version``, ``artifact_tag``, ``org_id``, ``prompt_version``, and
    ``language`` don't affect the underlying provider call, but embedding
    them in the cache key ensures a stale response isn't served after the
    configured model/provider changes, after an evidence artifact referenced
    by the claim is updated, after the org changes, after the active prompt
    version is bumped, or after the language of the claim changes.
    """
    return humanitarian_verification_service.verify_claim(
        aid_claim=aid_claim,
        supporting_evidence=supporting_evidence,
        context_factors=context_factors,
        provider_preference=provider_preference,
        timeout=timeout,
        prompt_version=prompt_version or None,
        language=language,
    )


@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    request: HumanitarianVerificationRequest,
    raw_request: Request,
    x_org_id: str = Header(default="", alias="X-Org-Id"),
    x_user_id: str = Header(default="", alias="X-User-Id"),
    x_user_role: str = Header(default="", alias="X-User-Role"),
) -> ResultEnvelope[Dict[str, Any]]:
    """Verify an aid claim against standardised humanitarian criteria.

    Validates that all referenced evidence artifacts belong to the requesting
    organization before processing.  Maintains audit logs for access attempts.

    ``artifact_access_control`` and ``humanitarian_verification_service`` are
    resolved from ``request.app.state``.  Production wires them up in the
    lifespan of ``main.app``; tests inject lightweight Mocks via the same
    state so we never have to monkeypatch ``main`` module globals.
    """
    from main import correlation_id_var

    logger.info("Processing humanitarian verification request")

    try:
        service = raw_request.app.state.humanitarian_verification_service
        artifact_access_control = getattr(
            raw_request.app.state, "artifact_access_control", None
        )
        org_id = x_org_id or ""

        # Verify caller owns every referenced evidence artifact.
        if artifact_access_control is not None and request.artifact_ids:
            artifact_access_control.verify_ownership(
                artifact_ids=request.artifact_ids,
                org_id=org_id,
                user_id=x_user_id,
                user_role=x_user_role,
            )

        model_version = service.get_model_version(request.provider_preference)
        artifact_tag = (
            ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""
        )

        effective_prompt_version = request.prompt_version or service.get_prompt_version(
            "humanitarian_primary"
        )

        raw = await _verify_claim_cached(
            humanitarian_verification_service=service,
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
            timeout=request.timeout,
            model_version=model_version,
            artifact_tag=artifact_tag,
            org_id=org_id,
            prompt_version=effective_prompt_version,
            content_hash="",
            language=request.language,
        )

        verification: Dict[str, Any] = raw.get("verification") or {}

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
        raise
