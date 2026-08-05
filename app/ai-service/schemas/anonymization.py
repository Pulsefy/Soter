from typing import Any, Dict, List, Literal, Optional

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


# ---------------------------------------------------------------------------
# Redaction Preview Diff
# ---------------------------------------------------------------------------


class RedactionPreviewRequest(BaseModel):
    """Request body for the redaction preview diff endpoint."""

    text: str = Field(
        min_length=1,
        description="Input text to preview redactions for.",
        examples=["John Doe from New York on 2024-01-01 requested aid"],
    )
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text": "John Doe from New York on 2024-01-01 requested aid",
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"},
                }
            ]
        }
    }


class RedactionDiffSegment(BaseModel):
    """A single segment in the redaction preview diff.

    ``kind`` is ``"text"`` for safe passages that would be kept as-is, or
    ``"redaction"`` for spans that would be replaced by a token.  The
    ``content`` field always holds the *original* text so the caller can
    reconstruct the full input.  ``replacement`` and ``pii_type`` are only
    populated for redaction segments.
    """

    kind: Literal["text", "redaction"] = Field(
        description="Segment kind: 'text' for safe passages, 'redaction' for PII spans.",
    )
    content: str = Field(
        description="Original text of this segment.",
    )
    start: int = Field(
        ge=0,
        description="Character offset (inclusive) in the original input.",
    )
    end: int = Field(
        ge=0,
        description="Character offset (exclusive) in the original input.",
    )
    replacement: Optional[str] = Field(
        None,
        description="Token that would replace this segment (e.g. '[RECIPIENT_NAME]'). Only set for redaction segments.",
        examples=["[RECIPIENT_NAME]"],
    )
    pii_type: Optional[str] = Field(
        None,
        description="PII category detected (e.g. 'PERSON', 'LOCATION'). Only set for redaction segments.",
        examples=["PERSON"],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "kind": "text",
                    "content": "On 15 Jan 2025, ",
                    "start": 0,
                    "end": 17,
                },
                {
                    "kind": "redaction",
                    "content": "Mary Johnson",
                    "start": 17,
                    "end": 29,
                    "replacement": "[RECIPIENT_NAME]",
                    "pii_type": "PERSON",
                },
            ]
        }
    }


class RedactionPreviewResult(BaseModel):
    """Payload nested inside the ResultEnvelope for redaction preview responses."""

    segments: List[RedactionDiffSegment] = Field(
        description="Ordered list of text and redaction segments covering the full input.",
    )
    original_length: int = Field(
        ge=0,
        examples=[50],
        description="Character length of the original input.",
    )
    redacted_text: str = Field(
        examples=["[RECIPIENT_NAME] from [LOCATION] on [EVENT_DATE] requested aid"],
        description="Fully anonymized text that would be produced by the anonymize endpoint.",
    )
    pii_summary: Dict[str, Any] = Field(
        default_factory=dict,
        examples=[{"names": 1, "locations": 1, "dates": 1, "total": 3}],
        description="Count of detected PII items grouped by category.",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "segments": [
                        {"kind": "text", "content": "On 15 Jan 2025, ", "start": 0, "end": 17},
                        {"kind": "redaction", "content": "Mary Johnson", "start": 17, "end": 29, "replacement": "[RECIPIENT_NAME]", "pii_type": "PERSON"},
                        {"kind": "text", "content": " received aid in ", "start": 29, "end": 45},
                        {"kind": "redaction", "content": "Maiduguri Camp", "start": 45, "end": 59, "replacement": "[LOCATION]", "pii_type": "LOCATION"},
                    ],
                    "original_length": 60,
                    "redacted_text": "On 15 Jan 2025, [RECIPIENT_NAME] received aid in [LOCATION].",
                    "pii_summary": {"names": 1, "locations": 1, "dates": 0, "total": 2},
                }
            ]
        }
    }
