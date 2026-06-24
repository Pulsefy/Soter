from typing import Dict

from pydantic import BaseModel, Field

from schemas.envelope import ResultEnvelope


class AnonymizeRequest(BaseModel):
    text: str = Field(min_length=1, description="Input text to anonymize before LLM processing")


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
