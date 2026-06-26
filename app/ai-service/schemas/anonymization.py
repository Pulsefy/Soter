from typing import Dict, Optional

from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class AnonymizeRequest(BaseModel):
    text: str = Field(min_length=1, description="Input text to anonymize before LLM processing")
    anchor_metadata: Optional[AnchorMetadata] = None


class PIISummary(BaseModel):
    names: int
    locations: int
    dates: int
    total: int


class AnonymizeResponse(BaseModel):
    success: bool
    anonymized_text: str
    original_length: int
    pii_summary: PIISummary
    token_counts: Dict[str, int] = Field(default_factory=dict)
    anchor_metadata: Optional[AnchorMetadata] = None
