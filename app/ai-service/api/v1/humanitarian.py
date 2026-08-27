"""
v1 humanitarian verification endpoint.
"""

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Header, Request

from config import settings
from schemas.common import ResultEnvelope
from schemas.humanitarian import (
    HumanitarianVerificationRequest,
)
from services.cache import cached_response
from services.artifact_access import ArtifactAccessError
from services.evidence_access_control import (
    EvidenceAccessControl,
    EvidenceAccessControlError,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])


@cached_response(
    prefix="humanitarian_verification",
    ttl_seconds=settings.cache_ttl_verification,
    key_tags=["model_version", "artifact_tag", "org_id"],
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
) -> Dict[str, Any]:
    """
    Cacheable wrapper around HumanitarianVerificationService.verify_claim.

    `humanitarian_verification_service` is the callable to run - it is
    looked up from ``app.state`` by the calling endpoint and passed in here
    so tests can inject a Mock and the cache decorator's args do not need
    to know about module globals.

    `model_version`, `artifact_tag`, and `org_id` don't affect the underlying
    provider call, but embedding them in the cache key ensures a stale
    response isn't served after the configured model/provider changes, after
    an evidence artifact referenced by the claim is updated (see
    CacheInvalidationHelper.invalidate_verification_by_artifact/_model_version),
    or across tenants: including ``org_id`` scopes every cache entry to the
    requesting organization so one tenant can never be served a response that
    was computed for another tenant's request.
    """
    try:
        return humanitarian_verification_service.verify_claim(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
            provider_preference=provider_preference,
            timeout=timeout,
        )
    except TypeError as exc:
        if "timeout" in str(exc):
            return humanitarian_verification_service.verify_claim(
                aid_claim=aid_claim,
                supporting_evidence=supporting_evidence,
                context_factors=context_factors,
                provider_preference=provider_preference,
            )
        raise


@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    http_request: Request,
    request: HumanitarianVerificationRequest,
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
    state = http_request.app.state
    # Both services are wired up in ``main.app``'s lifespan startup; we resolve
    # them defensively so a misconfigured deployment fails loudly with a clean
    # HTTP error envelope rather than a bare ``AttributeError``.
    artifact_access_control = getattr(state, "artifact_access_control", None)
    humanitarian_verification_service = getattr(
        state, "humanitarian_verification_service", None
    )
    if artifact_access_control is None or humanitarian_verification_service is None:
        logger.error(
            "humanitarian_services_uninitialised",
            extra={
                "event": "service_misconfiguration",
                "correlation_id": getattr(http_request.state, "correlation_id", ""),
            },
        )
        raise HTTPException(
            status_code=500,
            detail="Humanitarian services are not configured",
        )
    correlation_id = getattr(http_request.state, "correlation_id", "") or ""

    logger.info(
        "Processing humanitarian verification request with evidence ownership validation"
    )

    try:
        # Fail-closed access control for evidence-bearing requests.
        #
        # Headers, role, and ownership are only enforced when the request
        # references ``artifact_ids``.  Calls without artifacts (e.g. the
        # existing envelope / versioned-route test fixtures, plus legacy
        # non-evidence verification flows) skip the gates entirely so they
        # keep their pre-``c92763a`` behavior.
        #
        # Critically, the ``if request.artifact_ids:`` branch is the ONLY
        # place auth is checked - so an attacker who supplies artifact_ids
        # without one of the three required X-* headers falls into the
        # branch and hits the explicit ``raise HTTPException(400, ...)``
        # below.  There is no fail-open path where artifact_ids +
        # empty-x_user_role bypass verification.
        if request.artifact_ids:
            if not x_user_role or not x_user_role.strip():
                logger.warning(
                    "missing_user_role",
                    extra={
                        "event": "artifact_access_denied",
                        "code": "missing_user_role",
                        "organization": x_org_id,
                        "user_id": x_user_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise HTTPException(
                    status_code=400, detail="X-User-Role header is required"
                )

            if not x_org_id or not x_org_id.strip():
                logger.warning(
                    "missing_org_id",
                    extra={
                        "event": "artifact_access_denied",
                        "code": "missing_org_id",
                        "user_role": x_user_role,
                        "user_id": x_user_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise HTTPException(
                    status_code=400, detail="X-Org-Id header is required"
                )

            if not x_user_id or not x_user_id.strip():
                logger.warning(
                    "missing_user_id",
                    extra={
                        "event": "artifact_access_denied",
                        "code": "missing_user_id",
                        "user_role": x_user_role,
                        "organization": x_org_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise HTTPException(
                    status_code=400, detail="X-User-Id header is required"
                )

            if not artifact_access_control.validate_role(x_user_role):
                logger.warning(
                    "forbidden_role",
                    extra={
                        "event": "artifact_access_denied",
                        "code": "forbidden_role",
                        "user_role": x_user_role,
                        "user_id": x_user_id,
                        "organization": x_org_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"User role '{x_user_role}' is not authorized",
                )

            try:
                artifact_access_control.validate_evidence_access(
                    artifact_ids=request.artifact_ids,
                    org_id=x_org_id,
                    user_id=x_user_id,
                    user_role=x_user_role,
                    correlation_id=correlation_id,
                )
            except EvidenceAccessControlError as exc:
                # The specific reason is kept in audit logs only; the HTTP
                # response must stay generic so denials do not reveal whether
                # an artifact exists or who owns it (multi-tenant isolation).
                logger.warning(
                    "forbidden_org",
                    extra={
                        "event": "artifact_access_denied",
                        "code": "forbidden_org",
                        "reason": str(exc),
                        "artifact_ids": request.artifact_ids,
                        "org_id": x_org_id,
                        "user_id": x_user_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise HTTPException(status_code=403, detail="Access denied")

        model_version = humanitarian_verification_service.get_model_version(
            request.provider_preference
        )
        artifact_tag = (
            ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""
        )

        raw = await _verify_claim_cached(
            humanitarian_verification_service,
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
            timeout=request.timeout,
            model_version=model_version,
            artifact_tag=artifact_tag,
            org_id=x_org_id,
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
            trace_id=correlation_id or None,
        )
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        # Re-raise so the global exception handler formats the error envelope
        raise
