"""
v1 anonymization endpoint.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException

from schemas.anonymization import AnonymizeRequest, AnonymizeResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["anonymization"])


@router.post("/ai/anonymize", response_model=AnonymizeResponse)
async def anonymize_text(request: AnonymizeRequest):
    """Anonymize names, locations, and dates before text is sent to external LLMs."""
    import main as _main

    trace_id = str(uuid.uuid4())
    logger.info("Processing privacy-preserving anonymization request")

    try:
        result = _main.pii_scrubber_service.anonymize(request.text)

        pii_summary = result.get("pii_summary", {})
        total_redacted = (
            pii_summary.get("total", 0)
            if isinstance(pii_summary, dict)
            else getattr(pii_summary, "total", 0)
        )

        reasons = ["PII scrubbing completed successfully"]
        if total_redacted:
            reasons.append(f"{total_redacted} PII token(s) redacted")
        else:
            reasons.append("No PII detected in input")

        # Strip envelope keys so our explicit values take precedence.
        _ENVELOPE_KEYS = {"result", "confidence", "reasons", "anchor_metadata", "trace_id"}
        safe_result = {k: v for k, v in result.items() if k not in _ENVELOPE_KEYS}

        return AnonymizeResponse(
            success=True,
            **safe_result,
            # Standard result envelope fields (Issue #609)
            result="anonymization_complete",
            confidence=None,  # rule-based; no probabilistic confidence
            reasons=reasons,
            anchor_metadata={
                "original_length": result.get("original_length"),
                "pii_total": total_redacted,
            },
            trace_id=trace_id,
        )
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")
