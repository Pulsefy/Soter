from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class BatchOCRDocumentStatus(BaseModel):
    filename: str | None = None
    status: str
    task_id: str | None = None
    status_url: str | None = None
    error: dict[str, str] | None = None


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
