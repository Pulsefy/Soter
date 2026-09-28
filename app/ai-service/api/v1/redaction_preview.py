"""
v1 redaction preview-diff endpoint.
"""

import logging

from fastapi import APIRouter, HTTPException

from schemas.anonymization import AnonymizeRequest, RedactionPreviewResult
from schemas.common import ResultEnvelope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["anonymization"])


@router.post(
    "/ai/redaction/preview", response_model=ResultEnvelope[RedactionPreviewResult]
)
async def preview_redaction(
    request: AnonymizeRequest,
) -> ResultEnvelope[RedactionPreviewResult]:
    """Return a redaction diff (kept vs. redacted segments) without masking the text."""
    import main as _main
    from main import correlation_id_var

    logger.info("Processing redaction preview request")

    try:
        text = request.text
        service = _main.pii_scrubber_service

        spans = service.detect_spans(text)
        segments = service.build_preview_segments(text, spans)

        names = sum(1 for s in spans if s.label == "PERSON")
        locations = sum(1 for s in spans if s.label == "LOCATION")
        dates = sum(1 for s in spans if s.label == "DATE")
        emails = sum(1 for s in spans if s.label == "EMAIL")
        phones = sum(1 for s in spans if s.label == "PHONE")
        ids = sum(1 for s in spans if s.label == "ID")

        result = RedactionPreviewResult(
            original_length=len(text),
            segments=segments,
            pii_summary={
                "names": names,
                "locations": locations,
                "dates": dates,
                "emails": emails,
                "phones": phones,
                "ids": ids,
                "total": len(spans),
            },
        )

        reasons = (
            [f"Found {len(spans)} item(s) that would be redacted."]
            if spans
            else ["No PII detected in input text."]
        )

        return ResultEnvelope[RedactionPreviewResult](
            result=result,
            confidence=None,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as e:
        logger.error(f"Redaction preview failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to generate redaction preview"
        )
