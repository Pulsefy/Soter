from typing import Dict

from pydantic import BaseModel, Field


class AnonymizeRequest(BaseModel):
    text: str = Field(min_length=1, description="Input text to anonymize before LLM processing")


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
