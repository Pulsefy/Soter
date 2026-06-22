"""
v1 anonymization endpoint.
"""

import logging

from fastapi import APIRouter, HTTPException

from schemas.anonymization import AnonymizeRequest, AnonymizeResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["anonymization"])


@router.post("/ai/anonymize", response_model=AnonymizeResponse)
async def anonymize_text(request: AnonymizeRequest):
    """Anonymize names, locations, and dates before text is sent to external LLMs."""
    import main as _main

    logger.info("Processing privacy-preserving anonymization request")

    try:
        result = _main.pii_scrubber_service.anonymize(request.text)
        return AnonymizeResponse(success=True, **result)
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")
