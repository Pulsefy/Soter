from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata

# Per-document outcome reported by the batch OCR API.
#   pending    - queued, not yet picked up by a worker
#   processing - a worker has started (or is retrying) the job
#   succeeded  - the job finished; its result is on ``status_url``
#   failed     - terminal failure; ``error`` carries the reason
BatchOCRDocumentState = Literal["pending", "processing", "succeeded", "failed"]

# Roll-up state for a whole batch, so a partially failed batch is
# distinguishable from a fully failed or fully succeeded one.
#   processing        - at least one document is still pending/processing
#   succeeded         - every document succeeded
#   failed            - every document failed
#   partially_failed  - some succeeded, some failed, none still running
BatchOCRBatchState = Literal["processing", "succeeded", "failed", "partially_failed"]


class BatchOCRDocumentStatus(BaseModel):
    document_id: str | None = Field(
        None,
        description=(
            "Stable id of this document within the batch; address retries with "
            "it so duplicate filenames stay unambiguous."
        ),
    )
    filename: str | None = None
    status: BatchOCRDocumentState = Field(
        description="Outcome for this document: pending, processing, succeeded or failed."
    )
    task_id: str | None = None
    status_url: str | None = Field(
        None, description="Poll URL for this document's queued OCR job."
    )
    retry_url: str | None = Field(
        None,
        description=(
            "Present only while the document is failed and its upload is still "
            "retained; POST here to requeue just this document."
        ),
    )
    error: dict[str, str] | None = Field(
        None, description="Failure reason when status is failed."
    )


class BatchOCRSummary(BaseModel):
    """Per-state document counts for a batch."""

    total: int = Field(examples=[10])
    pending: int = 0
    processing: int = 0
    succeeded: int = 0
    failed: int = 0


class BatchOCRStatusResponse(BaseModel):
    """Pollable per-document breakdown of a batch."""

    batch_id: str
    status: BatchOCRBatchState = Field(
        description=(
            "processing while documents are still running, then succeeded, "
            "failed, or partially_failed once every document reached a "
            "terminal state."
        )
    )
    status_url: str
    summary: BatchOCRSummary
    documents: list[BatchOCRDocumentStatus]


class BatchOCRResponse(BaseModel):
    success: bool = Field(examples=[True])
    batch_id: str
    status: BatchOCRBatchState
    status_url: str = Field(
        description="Poll for the per-document outcome breakdown of this batch."
    )
    summary: BatchOCRSummary
    documents: list[BatchOCRDocumentStatus]


class LanguageHint(str, Enum):
    eng = "eng"
    spa = "spa"
    fra = "fra"
    deu = "deu"
    ita = "ita"
    por = "por"
    chi_sim = "chi_sim"
    ara = "ara"
    hin = "hin"
    jpn = "jpn"


class OCRConfidenceBand(str, Enum):
    """Reliability band derived from the configured OCR thresholds."""

    high = "high"
    medium = "medium"
    low = "low"


class OCRFieldResult(BaseModel):
    value: str = Field(examples=["John Doe"])
    confidence: float = Field(0.0, examples=[0.95])

    model_config = {
        "json_schema_extra": {"examples": [{"value": "John Doe", "confidence": 0.95}]}
    }


class OCRData(BaseModel):
    fields: dict[str, OCRFieldResult] = Field(
        examples=[
            {
                "full_name": {"value": "John Doe", "confidence": 0.95},
                "id_number": {"value": "123456789", "confidence": 0.90},
            }
        ]
    )
    raw_text: str = Field(examples=["John Doe\nID: 123456789"])
    processing_time_ms: int = Field(examples=[1500])
    # Confidence banding / manual-review routing (issue #984). A result whose
    # aggregate confidence is below the active review threshold (or that
    # carries no confidence at all) is flagged with ``needs_review=True`` so
    # the backend can send it to a human instead of trusting it blindly.
    confidence: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description=(
            "Mean confidence across the detected fields, or null when no "
            "field carried a confidence value."
        ),
        examples=[0.91],
    )
    confidence_band: Optional[OCRConfidenceBand] = Field(
        None,
        description="high/medium/low band derived from the configured thresholds.",
        examples=["high"],
    )
    needs_review: bool = Field(
        False,
        description=(
            "True when the extraction is missing confidence or falls below "
            "the review threshold; a human should verify the document."
        ),
        examples=[False],
    )
    review_threshold: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Review threshold in force for this document type.",
        examples=[0.75],
    )
    document_type: Optional[str] = Field(
        None,
        description="Document type used to select the review threshold, when supplied.",
        examples=["id_card"],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "fields": {
                        "full_name": {"value": "John Doe", "confidence": 0.95},
                        "id_number": {"value": "123456789", "confidence": 0.90},
                    },
                    "raw_text": "John Doe\nID: 123456789",
                    "processing_time_ms": 1500,
                    "confidence": 0.925,
                    "confidence_band": "high",
                    "needs_review": False,
                    "review_threshold": 0.75,
                    "document_type": "id_card",
                }
            ]
        }
    }


class OCRResponse(BaseModel):
    success: bool = Field(examples=[True])
    data: OCRData | None = None
    error: dict[str, str] | None = Field(
        None, examples=[{"code": "invalid_image", "message": "Could not decode image"}]
    )
    processing_time_ms: int = Field(examples=[1500])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "data": {
                        "fields": {
                            "full_name": {"value": "John Doe", "confidence": 0.95},
                            "id_number": {"value": "123456789", "confidence": 0.90},
                        },
                        "raw_text": "John Doe\nID: 123456789",
                        "processing_time_ms": 1500,
                    },
                    "processing_time_ms": 1500,
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
                },
                {
                    "success": False,
                    "error": {
                        "code": "invalid_image",
                        "message": "Could not decode image",
                    },
                    "processing_time_ms": 500,
                },
            ]
        }
    }
