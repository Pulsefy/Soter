"""
v1 humanitarian verification endpoint.
"""

import logging

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

    logger.info("Processing humanitarian verification request")

    try:
        base_kwargs = {
            "aid_claim": request.aid_claim,
            "supporting_evidence": request.supporting_evidence,
            "context_factors": request.context_factors,
            "anchor_metadata": (
                request.anchor_metadata.model_dump(exclude_none=True)
                if request.anchor_metadata
                else None
            ),
            "provider_preference": request.provider_preference,
        }
        optional_variants = [
            {"timeout": request.timeout},
            {},
        ]

        result = None
        last_error = None
        for optional_kwargs in optional_variants:
            try:
                result = _main.humanitarian_verification_service.verify_claim(
                    **base_kwargs,
                    **optional_kwargs,
                )
                break
            except TypeError as exc:
                last_error = exc
                message = str(exc)
                if "timeout" in message or "anchor_metadata" in message or "unexpected keyword argument" in message:
                    fallback_kwargs = dict(base_kwargs)
                    fallback_kwargs.pop("anchor_metadata", None)
                    if optional_kwargs:
                        try:
                            result = _main.humanitarian_verification_service.verify_claim(
                                **fallback_kwargs,
                            )
                            break
                        except TypeError as inner_exc:
                            last_error = inner_exc
                            continue
                    continue
                raise exc

        if result is None and last_error is not None:
            raise last_error
        return HumanitarianVerificationResponse(success=True, **result)
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        return HumanitarianVerificationResponse(success=False, error=str(e))
