from typing import Any, Dict, Optional

from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class AnonymizeRequest(BaseModel):
    text: str = Field(
        min_length=1,
        description="Input text to anonymize before LLM processing",
        examples=["John Doe from New York on 2024-01-01 requested aid"],
    )
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text": "John Doe from New York on 2024-01-01 requested aid",
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
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


class AnonymizeResult(BaseModel):
    """Payload nested inside the ResultEnvelope for anonymization responses."""

    anonymized_text: str = Field(
        examples=["[NAME] from [LOCATION] on [DATE] requested aid"]
    )
    original_length: int = Field(examples=[50])
    pii_summary: Dict[str, Any] = Field(
        default_factory=dict,
        examples=[{"names": 1, "locations": 1, "dates": 1, "total": 3}],
    )
    token_counts: Dict[str, int] = Field(
        default_factory=dict, examples=[{"original": 10, "anonymized": 10}]
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "anonymized_text": "[NAME] from [LOCATION] on [DATE] requested aid",
                    "original_length": 50,
                    "pii_summary": {"names": 1, "locations": 1, "dates": 1, "total": 3},
                    "token_counts": {
                        "[RECIPIENT_NAME]": 1,
                        "[LOCATION]": 1,
                        "[EVENT_DATE]": 1,
                    },
                }
            ]
        }
    }


class AnonymizeResponse(BaseModel):
    """
    Legacy response model — kept for backward compatibility.
    New consumers should use the ``ResultEnvelope[AnonymizeResult]`` shape
    returned by the v1 endpoint.
    """

    success: bool = Field(examples=[True])
    anonymized_text: str = Field(
        examples=["[NAME] from [LOCATION] on [DATE] requested aid"]
    )
    original_length: int = Field(examples=[50])
    pii_summary: PIISummary
    token_counts: Dict[str, int] = Field(
        default_factory=dict, examples=[{"original": 10, "anonymized": 10}]
    )
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
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
                }
            ]
        }
    }


class RedactionSegment(BaseModel):
    """One contiguous span of the original text, marked kept or redacted."""

    type: str = Field(examples=["kept", "redacted"])
    start: int = Field(examples=[0])
    end: int = Field(examples=[8])
    category: Optional[str] = Field(
        None,
        description="PII category label, present only when type == 'redacted'",
        examples=["RECIPIENT_NAME"],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"type": "redacted", "start": 0, "end": 8, "category": "RECIPIENT_NAME"}
            ]
        }
    }


class RedactionPreviewResult(BaseModel):
    """Payload nested inside the ResultEnvelope for the redaction preview diff."""

    original_length: int = Field(examples=[60])
    segments: list[RedactionSegment] = Field(default_factory=list)
    pii_summary: Dict[str, Any] = Field(
        default_factory=dict,
        examples=[{"names": 1, "locations": 1, "dates": 1, "total": 3}],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "original_length": 60,
                    "segments": [
                        {"type": "kept", "start": 0, "end": 3, "category": None},
                        {
                            "type": "redacted",
                            "start": 3,
                            "end": 15,
                            "category": "RECIPIENT_NAME",
                        },
                    ],
                    "pii_summary": {"names": 1, "locations": 1, "dates": 1, "total": 3},
                }
            ]
        }
    }
