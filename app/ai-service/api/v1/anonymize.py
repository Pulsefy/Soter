"""
v1 anonymization endpoint.
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from schemas.anonymization import AnonymizeRequest, AnonymizeResult
from schemas.common import ResultEnvelope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["anonymization"])


@router.post("/ai/anonymize", response_model=ResultEnvelope[AnonymizeResult])
async def anonymize_text(request: AnonymizeRequest) -> ResultEnvelope[AnonymizeResult]:
    """Anonymize names, locations, and dates before text is sent to external LLMs."""
    import main as _main
    from main import correlation_id_var

    logger.info("Processing privacy-preserving anonymization request")

    try:
        raw: Dict[str, Any] = _main.pii_scrubber_service.anonymize(request.text)
        result = AnonymizeResult(**raw)

        # PII scrubbing is deterministic — no confidence score to report.
        reasons = (
            [f"Detected and masked {result.pii_summary.get('total', 0)} PII item(s)."]
            if result.pii_summary.get("total", 0) > 0
            else ["No PII detected in input text."]
        )

        return ResultEnvelope[AnonymizeResult](
            result=result,
            confidence=None,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")
