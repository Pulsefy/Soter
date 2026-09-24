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


class StructuredRedactionRequest(BaseModel):
    """Request for structured redaction/preview of named fields.

    Structured OCR output is handed in as the field-name -> value map the
    OCR pipeline produced; redaction is driven by each field's known type.
    """

    fields: Dict[str, str] = Field(
        ...,
        description=(
            "Structured OCR fields keyed by their field name, e.g. "
            "{\"full_name\": \"Aisha Bello\", \"national_id\": \"12345678901\"}"
        ),
        examples=[
            {
                "full_name": "Aisha Bello",
                "national_id": "12345678901",
                "date_of_birth": "1990-01-15",
            }
        ],
    )
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "fields": {
                        "full_name": "Aisha Bello",
                        "national_id": "12345678901",
                        "date_of_birth": "1990-01-15",
                    },
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
                }
            ]
        }
    }


class StructuredFieldStatus(BaseModel):
    """Preview status for one structured field."""

    field_name: str = Field(examples=["national_id"])
    category: Optional[str] = Field(
        None,
        description="PII category inferred from the field name, when known",
        examples=["ID"],
    )
    redacted: bool = Field(False, examples=[True])
    masked_value: Optional[str] = Field(
        None,
        description="Token the field would be replaced with when redacted",
        examples=["[ID_NUMBER]"],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "field_name": "national_id",
                    "category": "ID",
                    "redacted": True,
                    "masked_value": "[ID_NUMBER]",
                }
            ]
        }
    }


class StructuredRedactionResult(BaseModel):
    """Payload nested inside the ResultEnvelope for structured redaction preview."""

    total_fields: int = Field(examples=[3])
    redacted_fields: int = Field(examples=[3])
    fields: Dict[str, StructuredFieldStatus] = Field(
        default_factory=dict,
        description="Per-field preview status, keyed by field name",
    )
    pii_summary: Dict[str, Any] = Field(
        default_factory=dict,
        description="Per-category counts of fields that would be redacted",
        examples=[{"PERSON": 1, "ID": 1, "DATE": 1}],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "total_fields": 3,
                    "redacted_fields": 3,
                    "fields": {
                        "full_name": {
                            "field_name": "full_name",
                            "category": "PERSON",
                            "redacted": True,
                            "masked_value": "[RECIPIENT_NAME]",
                        },
                        "national_id": {
                            "field_name": "national_id",
                            "category": "ID",
                            "redacted": True,
                            "masked_value": "[ID_NUMBER]",
                        },
                        "date_of_birth": {
                            "field_name": "date_of_birth",
                            "category": "DATE",
                            "redacted": True,
                            "masked_value": "[EVENT_DATE]",
                        },
                    },
                    "pii_summary": {"PERSON": 1, "ID": 1, "DATE": 1},
                }
            ]
        }
    }
