"""
v1 redaction preview diff endpoint.

Returns a structured diff showing which segments of the input text would be
scrubbed before a final anonymization action is committed.  The original
content is never logged; the RedactionFilter on the logging pipeline provides
an additional safety net.
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from schemas.anonymization import RedactionPreviewRequest, RedactionPreviewResult
from schemas.common import ResultEnvelope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["anonymization"])


@router.post("/ai/redaction-preview", response_model=ResultEnvelope[RedactionPreviewResult])
async def redaction_preview(request: RedactionPreviewRequest) -> ResultEnvelope[RedactionPreviewResult]:
    """Preview what content would be scrubbed before committing anonymization.

    Returns a segment-level diff: ``"text"`` segments are safe passages
    kept as-is; ``"redaction"`` segments carry the replacement token and PII
    label for spans that would be masked.  The fully anonymized text is
    included for convenience.

    **Logging safety**: The handler never logs the raw input text.  Any
    accidental leakage is caught by the ``RedactionFilter`` installed on the
    application logger.
    """
    import main as _main
    from main import correlation_id_var

    logger.info("Processing redaction preview request")

    try:
        raw: Dict[str, Any] = _main.pii_scrubber_service.preview(request.text)
        result = RedactionPreviewResult(**raw)

        total = result.pii_summary.get("total", 0)
        reasons = (
            [f"Preview covers {len(result.segments)} segment(s) with {total} redaction(s)."]
            if total > 0
            else ["No PII detected; output matches input."]
        )

        return ResultEnvelope[RedactionPreviewResult](
            result=result,
            confidence=None,
            reasons=reasons,
            anchor_metadata=request.anchor_metadata,
            trace_id=correlation_id_var.get() or None,
        )
    except Exception as e:
        logger.error("Redaction preview failed: %s", str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate redaction preview")
