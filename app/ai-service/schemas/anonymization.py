from typing import Dict, Optional

from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata

from schemas.envelope import ResultEnvelope


class AnonymizeRequest(BaseModel):
    text: str = Field(min_length=1, description="Input text to anonymize before LLM processing")
    anchor_metadata: Optional[AnchorMetadata] = None


class PIISummary(BaseModel):
    names: int
    locations: int
    dates: int
    total: int


class AnonymizeResponse(ResultEnvelope):
    """Anonymization endpoint response – includes the standardised result envelope (Issue #609)."""

    success: bool
    anonymized_text: str
    original_length: int
    pii_summary: PIISummary
    token_counts: Dict[str, int] = Field(default_factory=dict)
    anchor_metadata: Optional[AnchorMetadata] = None
