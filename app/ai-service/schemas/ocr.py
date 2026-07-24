from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


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
        "json_schema_extra": {
            "examples": [{"value": "John Doe", "confidence": 0.95}]
        }
    }


class OCRData(BaseModel):
    fields: dict[str, OCRFieldResult] = Field(
        examples=[{"full_name": {"value": "John Doe", "confidence": 0.95}, "id_number": {"value": "123456789", "confidence": 0.90}}]
    )
    raw_text: str = Field(examples=["John Doe\nID: 123456789"])
    processing_time_ms: int = Field(examples=[1500])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "fields": {"full_name": {"value": "John Doe", "confidence": 0.95}, "id_number": {"value": "123456789", "confidence": 0.90}},
                    "raw_text": "John Doe\nID: 123456789",
                    "processing_time_ms": 1500
                }
            ]
        }
    }


class OCRResponse(BaseModel):
    success: bool = Field(examples=[True])
    data: OCRData | None = None
    error: dict[str, str] | None = Field(None, examples=[{"code": "invalid_image", "message": "Could not decode image"}])
    processing_time_ms: int = Field(examples=[1500])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "data": {
                        "fields": {"full_name": {"value": "John Doe", "confidence": 0.95}, "id_number": {"value": "123456789", "confidence": 0.90}},
                        "raw_text": "John Doe\nID: 123456789",
                        "processing_time_ms": 1500
                    },
                    "processing_time_ms": 1500,
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                },
                {
                    "success": False,
                    "error": {"code": "invalid_image", "message": "Could not decode image"},
                    "processing_time_ms": 500
                }
            ]
        }
    }


class BatchOCRDocumentResult(BaseModel):
    document_id: str = Field(
        description="Unique identifier for the document within the batch",
        examples=["doc-001"]
    )
    success: bool = Field(examples=[True])
    data: Optional[OCRData] = None
    error: Optional[dict[str, str]] = Field(
        None,
        examples=[{"code": "invalid_image", "message": "Could not decode image"}]
    )
    processing_time_ms: int = Field(examples=[1500])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "document_id": "doc-001",
                    "success": True,
                    "data": {
                        "fields": {"full_name": {"value": "John Doe", "confidence": 0.95}},
                        "raw_text": "John Doe",
                        "processing_time_ms": 1500
                    },
                    "processing_time_ms": 1500
                },
                {
                    "document_id": "doc-002",
                    "success": False,
                    "error": {"code": "invalid_image", "message": "Could not decode image"},
                    "processing_time_ms": 500
                }
            ]
        }
    }


class BatchOCRResponse(BaseModel):
    success: bool = Field(
        description="True if batch was processed (regardless of individual document results)",
        examples=[True]
    )
    batch_id: str = Field(
        description="Unique identifier for the batch job",
        examples=["batch-123"]
    )
    total_documents: int = Field(examples=[2])
    successful_documents: int = Field(examples=[1])
    failed_documents: int = Field(examples=[1])
    results: list[BatchOCRDocumentResult] = Field(
        description="Per-document OCR results",
        examples=[[]]
    )
    total_processing_time_ms: int = Field(examples=[2000])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "batch_id": "batch-123",
                    "total_documents": 2,
                    "successful_documents": 1,
                    "failed_documents": 1,
                    "results": [
                        {
                            "document_id": "doc-001",
                            "success": True,
                            "data": {
                                "fields": {"full_name": {"value": "John Doe", "confidence": 0.95}},
                                "raw_text": "John Doe",
                                "processing_time_ms": 1500
                            },
                            "processing_time_ms": 1500
                        },
                        {
                            "document_id": "doc-002",
                            "success": False,
                            "error": {"code": "invalid_image", "message": "Could not decode image"},
                            "processing_time_ms": 500
                        }
                    ],
                    "total_processing_time_ms": 2000
                }
            ]
        }
    }


class BatchOCRJobResponse(BaseModel):
    success: bool = Field(examples=[True])
    batch_job_id: str = Field(
        description="Unique identifier for tracking the batch job",
        examples=["batch-job-123"]
    )
    document_count: int = Field(examples=[2])
    status: str = Field(examples=["pending"])
    message: str = Field(examples=["Batch OCR job queued for processing"])
    status_url: str = Field(examples=["/v1/ai/jobs/batch-job-123"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "batch_job_id": "batch-job-123",
                    "document_count": 2,
                    "status": "pending",
                    "message": "Batch OCR job queued for processing",
                    "status_url": "/v1/ai/jobs/batch-job-123"
                }
            ]
        }
    }
