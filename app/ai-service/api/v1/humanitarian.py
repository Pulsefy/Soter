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
        result = _main.humanitarian_verification_service.verify_claim(
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
        )
        return HumanitarianVerificationResponse(success=True, **result)
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        return HumanitarianVerificationResponse(success=False, error=str(e))
