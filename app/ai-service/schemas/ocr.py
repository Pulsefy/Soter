from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class ConfidenceBanding(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


class BatchOCRDocumentStatus(BaseModel):
    filename: str | None = None
    status: str
    task_id: str | None = None
    status_url: str | None = None
    error: dict[str, str] | None = None
    requires_review: Optional[bool] = None
    confidence: Optional[float] = None
    confidence_banding: Optional[str] = None


class BatchOCRResponse(BaseModel):
    success: bool = Field(examples=[True])
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
    confidence: Optional[float] = Field(
        default=None,
        description="Aggregate confidence score in [0, 1] across detected fields",
        examples=[0.925],
    )
    confidence_banding: Optional[str] = Field(
        default=None,
        description="Confidence classification banding: HIGH, MEDIUM, LOW, UNKNOWN",
        examples=["HIGH"],
    )
    requires_review: bool = Field(
        default=False,
        description="True if extraction falls below confidence threshold or requires manual review",
        examples=[False],
    )
    review_reasons: list[str] = Field(
        default_factory=list,
        description="Reasons why this extraction was flagged for manual review",
        examples=[[]],
    )
    document_type: Optional[str] = Field(
        default=None,
        description="Document type applied for threshold evaluation",
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
                    "confidence_banding": "HIGH",
                    "requires_review": False,
                    "review_reasons": [],
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
    confidence: Optional[float] = None
    confidence_banding: Optional[str] = None
    requires_review: Optional[bool] = None
    review_reasons: list[str] = Field(default_factory=list)

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
                        "confidence": 0.925,
                        "confidence_banding": "HIGH",
                        "requires_review": False,
                        "review_reasons": [],
                        "document_type": "id_card",
                    },
                    "processing_time_ms": 1500,
                    "confidence": 0.925,
                    "confidence_banding": "HIGH",
                    "requires_review": False,
                    "review_reasons": [],
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
