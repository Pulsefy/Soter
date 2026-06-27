from typing import Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata

from schemas.envelope import ResultEnvelope


class OCRFieldResult(BaseModel):
    value: str
    confidence: float = 0.0


class OCRData(BaseModel):
    fields: dict[str, OCRFieldResult]
    raw_text: str
    processing_time_ms: int


class OCRResponse(ResultEnvelope):
    """OCR endpoint response – includes the standardised result envelope (Issue #609)."""

    success: bool
    data: OCRData | None = None
    error: dict[str, str] | None = None
    processing_time_ms: int
    anchor_metadata: Optional[AnchorMetadata] = None
