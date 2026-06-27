"""
v1 humanitarian verification endpoint.
"""

import logging
import uuid

from fastapi import APIRouter

from schemas.humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])


@router.post("/ai/humanitarian/verify", response_model=HumanitarianVerificationResponse)
async def verify_humanitarian_claim(request: HumanitarianVerificationRequest):
    """Verify an aid claim against standardised humanitarian criteria."""
    # Delegate to the singleton owned by main.py so that monkeypatching in
    # tests (and any future dependency-injection wiring) works transparently.
    import main as _main

    trace_id = str(uuid.uuid4())
    logger.info("Processing humanitarian verification request")

    try:
        try:
            result = _main.humanitarian_verification_service.verify_claim(
                aid_claim=request.aid_claim,
                supporting_evidence=request.supporting_evidence,
                context_factors=request.context_factors,
                provider_preference=request.provider_preference,
                timeout=request.timeout,
            )
        except TypeError as exc:
            if "timeout" in str(exc):
                result = _main.humanitarian_verification_service.verify_claim(
                    aid_claim=request.aid_claim,
                    supporting_evidence=request.supporting_evidence,
                    context_factors=request.context_factors,
                    provider_preference=request.provider_preference,
                )
            else:
                raise exc

        # Extract envelope fields from the nested verification dict.
        verification = result.get("verification") or {}
        confidence_raw = verification.get("confidence")
        confidence = float(confidence_raw) if confidence_raw is not None else None
        verdict = verification.get("verdict")
        summary = verification.get("summary")

        result_label = f"humanitarian_{verdict}" if verdict else "humanitarian_verified"

        reasons: list[str] = []
        if verdict:
            reasons.append(f"Verdict: {verdict}")
        if summary:
            reasons.append(summary)

        # Strip any envelope-conflicting keys from the service result dict before
        # spreading, so our explicit envelope values always take precedence.
        _ENVELOPE_KEYS = {"result", "confidence", "reasons", "anchor_metadata", "trace_id"}
        safe_result = {k: v for k, v in result.items() if k not in _ENVELOPE_KEYS}

        return HumanitarianVerificationResponse(
            success=True,
            **safe_result,
            # Standard result envelope fields (Issue #609)
            result=result_label,
            confidence=confidence,
            reasons=reasons or None,
            anchor_metadata={
                "provider": result.get("provider"),
                "model": result.get("model"),
                "prompt_variant": result.get("prompt_variant"),
            },
            trace_id=trace_id,
        return HumanitarianVerificationResponse(
            success=True,
            anchor_metadata=request.anchor_metadata,
            **result
        )
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        return HumanitarianVerificationResponse(
            success=False,
            error=str(e),
            result="humanitarian_error",
            reasons=[str(e)],
            trace_id=trace_id,
            anchor_metadata=request.anchor_metadata
        )
