"""
v1 humanitarian verification endpoint.
"""

import hashlib
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
from services.decision_audit import get_store as get_decision_audit_store
from services.humanitarian_prompt import HUMANITARIAN_PROMPT_VERSION
from services.evidence_access_control import (
    EvidenceAccessControl,
    EvidenceAccessControlError,
)
from request_limits import clamp_request_timeout

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])

#: Value written to ``decision_type`` on every audit record from this endpoint.
DECISION_TYPE = "humanitarian_verification"


def _compute_evidence_content_hash(
    artifact_ids: List[str], artifact_access_control: Any
) -> str:
    """Compute a content hash over the raw bytes of every evidence artifact.

    The hash uses only artifact *content* (each blob length-prefixed, in sorted
    artifact-ID order) so that re-uploading the same document under a new
    artifact ID yields the *same* hash. The endpoint uses it as a cache key that
    is independent of artifact identity (see ``content_hash_arg`` on
    ``@cached_response``), so a resubmitted claim referencing a re-uploaded
    evidence document reuses the previously computed verification result instead
    of triggering another paid provider call.

    Returns ``""`` when there are no artifacts or any artifact cannot be read;
    the caller then falls back to artifact-ID-keyed caching alone. Cache keying
    is best-effort and must never fail the request.
    """
    if not artifact_ids:
        return ""
    access_service = getattr(artifact_access_control, "artifact_access_service", None)
    if access_service is None:
        access_service = artifact_access_control

    hasher = hashlib.sha256()
    for artifact_id in sorted(artifact_ids):
        try:
            artifact_path, _metadata = access_service.resolve_artifact(artifact_id)
            with open(artifact_path, "rb") as f:
                data = f.read()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "evidence_content_hash_skipped",
                extra={
                    "event": "evidence_content_hash_skipped",
                    "artifact_id": artifact_id,
                    "error": str(exc),
                },
            )
            return ""
        hasher.update(len(data).to_bytes(8, "big"))
        hasher.update(data)
    return hasher.hexdigest()


def _resolve_audit_store(http_request: Request):
    """Resolve the decision audit store (issue #990).

    Prefers ``app.state`` - matching how the other collaborators on this
    endpoint are wired and how tests inject fakes - and falls back to the
    process-wide store published by ``main``.
    """
    store = getattr(http_request.app.state, "decision_audit_store", None)
    return store if store is not None else get_decision_audit_store()


def _audit_inputs(request: HumanitarianVerificationRequest) -> Dict[str, Any]:
    """Build the ``inputs`` half of the audit record.

    Everything a reviewer needs to re-run the decision by hand. The values are
    redacted by the store per ``logging_redaction.py`` before they are written,
    so the claim text and evidence can be captured verbatim here.
    """
    return {
        "aid_claim": request.aid_claim,
        "supporting_evidence": list(request.supporting_evidence),
        "context_factors": dict(request.context_factors),
        "artifact_ids": list(request.artifact_ids),
        "provider_preference": request.provider_preference,
        "requested_timeout": request.timeout,
    }


def _write_audit_record(
    http_request: Request,
    request: HumanitarianVerificationRequest,
    *,
    outcome: str,
    correlation_id: str,
    org_id: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    prompt_variant: Optional[str] = None,
    confidence: Optional[float] = None,
    reasons: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Durably record one verification decision (issue #990).

    Best-effort by design: ``DecisionAuditStore.record`` swallows its own
    storage errors, and this wrapper guards the lookup as well, so an audit
    problem can never turn a completed verification into a 500.
    """
    store = _resolve_audit_store(http_request)
    if store is None:
        logger.warning(
            "decision_audit_store_unavailable",
            extra={"event": "decision_audit_skipped", "correlation_id": correlation_id},
        )
        return
    anchor = request.anchor_metadata
    try:
        store.record(
            DECISION_TYPE,
            outcome,
            trace_id=correlation_id,
            claim_id=getattr(anchor, "claim_id", None),
            campaign_ref=getattr(anchor, "campaign_ref", None),
            package_id=getattr(anchor, "package_id", None),
            org_id=org_id,
            provider=provider,
            model=model,
            prompt_version=HUMANITARIAN_PROMPT_VERSION,
            prompt_variant=prompt_variant,
            confidence=confidence,
            reasons=reasons or [],
            inputs=_audit_inputs(request),
            metadata=metadata or {},
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("decision_audit_record_failed: %s", exc)


@cached_response(
    prefix="humanitarian_verification",
    ttl_seconds=settings.cache_ttl_verification,
    key_tags=["model_version", "artifact_tag", "org_id", "prompt_version"],
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
) -> Dict[str, Any]:
    """
    Cacheable wrapper around HumanitarianVerificationService.verify_claim.

    `humanitarian_verification_service` is the callable to run - it is
    looked up from ``app.state`` by the calling endpoint and passed in here
    so tests can inject a Mock and the cache decorator's args do not need
    to know about module globals.

    `model_version`, `artifact_tag`, `org_id`, and `prompt_version` don't
    affect the underlying provider call, but embedding them in the cache key
    ensures a stale response isn't served after the configured model/provider
    changes, the prompt version changes, after an evidence artifact referenced
    by the claim is updated (see
    CacheInvalidationHelper.invalidate_verification_by_artifact/_model_version/_prompt_version),
    or across tenants: including ``org_id`` scopes every cache entry to the
    requesting organization so one tenant can never be served a response that
    was computed for another tenant's request.

    `content_hash` is a SHA-256 of the evidence artifact content (see
    ``_compute_evidence_content_hash``). It does NOT affect the provider call,
    but the decorator uses it as an additional cache key that is independent of
    artifact identity: an identical document re-uploaded under a new artifact ID
    (a common occurrence when a claim is resubmitted) reuses the cached result
    instead of triggering a fresh, paid provider call.
    """
    try:
        return humanitarian_verification_service.verify_claim(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
            provider_preference=provider_preference,
            timeout=timeout,
            prompt_version=prompt_version or None,
        )
    except TypeError as exc:
        if "prompt_version" in str(exc) or "timeout" in str(exc):
            try:
                return humanitarian_verification_service.verify_claim(
                    aid_claim=aid_claim,
                    supporting_evidence=supporting_evidence,
                    context_factors=context_factors,
                    provider_preference=provider_preference,
                    timeout=timeout,
                )
            except TypeError:
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
        timeout = clamp_request_timeout(request.timeout, http_request.url.path)
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

        prompt_version = request.prompt_version
        if not prompt_version:
            if hasattr(humanitarian_verification_service, "get_prompt_version"):
                try:
                    pv = humanitarian_verification_service.get_prompt_version(
                        "humanitarian_primary"
                    )
                    prompt_version = pv if isinstance(pv, str) else "v1"
                except Exception:
                    prompt_version = "v1"
            else:
                prompt_version = "v1"

        model_version = humanitarian_verification_service.get_model_version(
            request.provider_preference
        )
        if not isinstance(model_version, str):
            model_version = "test:fixture"

        artifact_tag = (
            ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""
        )
        content_hash = _compute_evidence_content_hash(
            request.artifact_ids, artifact_access_control
        )

        raw = await _verify_claim_cached(
            humanitarian_verification_service,
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
            timeout=timeout,
            model_version=model_version,
            artifact_tag=artifact_tag,
            org_id=x_org_id,
            prompt_version=prompt_version,
            content_hash=content_hash,
        )

        verification: Dict[str, Any] = (
            raw.get("verification") if isinstance(raw, dict) else {}
        )
        if not isinstance(verification, dict):
            verification = {}

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

        # Issue #990: durably record the decision *before* it is returned,
        # capturing the inputs, provider, model, prompt version, and outcome
        # that produced it. ``eligible`` is the disbursement-relevant outcome
        # when the model supplied it; otherwise the record still proves a
        # completed decision.
        eligible = verification.get("eligible")
        if isinstance(eligible, bool):
            outcome = "eligible" if eligible else "ineligible"
        else:
            outcome = "completed"
        _write_audit_record(
            http_request,
            request,
            outcome=outcome,
            correlation_id=correlation_id,
            org_id=x_org_id,
            provider=raw.get("provider"),
            model=raw.get("model"),
            prompt_variant=raw.get("prompt_variant"),
            confidence=confidence,
            reasons=reasons,
            metadata={
                "verification": verification,
                "model_version": model_version,
                "artifact_tag": artifact_tag,
                "user_id": x_user_id,
                "user_role": x_user_role,
            },
        )

        envelope_prompt_version: Optional[str] = None
        if isinstance(raw, dict) and isinstance(raw.get("prompt_version"), str):
            envelope_prompt_version = raw["prompt_version"]
        elif isinstance(prompt_version, str):
            envelope_prompt_version = prompt_version

        return ResultEnvelope[Dict[str, Any]](
            result=raw,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id or None,
            prompt_version=envelope_prompt_version,
        )
    except HTTPException as http_exc:
        # Access-control denials and misconfiguration are decisions too: they
        # determine that no verification happened, which is exactly what an
        # investigator needs to see weeks later.
        _write_audit_record(
            http_request,
            request,
            outcome="denied" if http_exc.status_code in (400, 403) else "error",
            correlation_id=correlation_id,
            org_id=x_org_id,
            reasons=[str(http_exc.detail)],
            metadata={
                "status_code": http_exc.status_code,
                "user_id": x_user_id,
                "user_role": x_user_role,
            },
        )
        raise
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        _write_audit_record(
            http_request,
            request,
            outcome="error",
            correlation_id=correlation_id,
            org_id=x_org_id,
            reasons=[str(e)],
            metadata={
                "error_type": type(e).__name__,
                "user_id": x_user_id,
                "user_role": x_user_role,
            },
        )
        # Re-raise so the global exception handler formats the error envelope
        raise
