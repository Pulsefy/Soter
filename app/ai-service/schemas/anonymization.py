from typing import Dict, Optional

from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class AnonymizeRequest(BaseModel):
    text: str = Field(min_length=1, description="Input text to anonymize before LLM processing", examples=["John Doe from New York on 2024-01-01 requested aid"])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text": "John Doe from New York on 2024-01-01 requested aid",
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                }
            ]
        }
    }


class PIISummary(BaseModel):
    names: int = Field(examples=[1])
    locations: int = Field(examples=[1])
    dates: int = Field(examples=[1])
    total: int = Field(examples=[3])

    model_config = {
        "json_schema_extra": {
            "examples": [{"names": 1, "locations": 1, "dates": 1, "total": 3}]
        }
    }


class AnonymizeResponse(BaseModel):
    success: bool = Field(examples=[True])
    anonymized_text: str = Field(examples=["[NAME] from [LOCATION] on [DATE] requested aid"])
    original_length: int = Field(examples=[50])
    pii_summary: PIISummary
    token_counts: Dict[str, int] = Field(default_factory=dict, examples=[{"original": 10, "anonymized": 10}])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "anonymized_text": "[NAME] from [LOCATION] on [DATE] requested aid",
                    "original_length": 50,
                    "pii_summary": {"names": 1, "locations": 1, "dates": 1, "total": 3},
                    "token_counts": {"original": 10, "anonymized": 10},
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                }
            ]
        }
    }
