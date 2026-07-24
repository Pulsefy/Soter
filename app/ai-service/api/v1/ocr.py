"""
v1 OCR endpoint.

Extracted from the legacy flat router so the route logic lives in a
single place and is referenced by both the /v1 and the legacy /ai mounts.
"""

import base64
import io
import json
import time
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

import tasks
from schemas.ocr import OCRData, BatchOCRResponse, BatchOCRJobResponse
from schemas.common import ResultEnvelope
from services.ocr_job import run_ocr_from_bytes, process_batch_ocr
from config import settings

router = APIRouter(tags=["ocr"])
limiter = Limiter(key_func=get_remote_address)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/bmp",
    "image/tiff",
    "image/webp",
}

class QueuedOCRResponse(BaseModel):
    success: bool
    task_id: str
    status: str
    message: str
    status_url: str


class BatchOCRDocumentRequest(BaseModel):
    document_id: str = Field(
        description="Unique identifier for the document",
        examples=["doc-001"]
    )
    # Note: In actual implementation, this would be file data from multipart form
    # For now, we'll accept base64 in JSON requests


@router.post("/ai/ocr")
@limiter.limit(settings.request_rate_limit)
async def process_ocr(
    request: Request,
    image: Annotated[UploadFile, File(description="Image file to process")],
    anchor_metadata: Annotated[Optional[str], Form(description="JSON encoded AnchorMetadata")] = None,
) -> ResultEnvelope[OCRData]:
    """Extract text fields from an uploaded document image."""
    start_time = time.time()

    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_content_type",
                "message": (
                    f"Invalid content type: {image.content_type}. "
                    f"Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}"
                ),
            },
        )

    try:
        contents = await image.read()

        if len(contents) == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "empty_image",
                    "message": "Uploaded image is empty",
                },
            )

        _validate_image_bytes(contents)
        raw = run_ocr_from_bytes(contents, anchor_metadata)

        from main import correlation_id_var
        ocr_data = OCRData(**raw["data"]) if isinstance(raw["data"], dict) else raw["data"]
        fields = ocr_data.fields
        avg_confidence: Optional[float] = (
            round(sum(f.confidence for f in fields.values()) / len(fields), 4)
            if fields
            else None
        )

        return ResultEnvelope[OCRData](
            result=ocr_data,
            confidence=avg_confidence,
            reasons=None,
            anchor_metadata=raw.get("anchor_metadata"),
            trace_id=correlation_id_var.get() or None,
        )

    except HTTPException:
        raise
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "processing_error",
                "message": str(e),
            },
        )


@router.post(
    "/ai/ocr/jobs",
    response_model=QueuedOCRResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit(settings.request_rate_limit)
async def queue_ocr_job(
    request: Request,
    image: Annotated[UploadFile, File(description="Image file to process")],
    anchor_metadata: Annotated[Optional[str], Form(description="JSON encoded AnchorMetadata")] = None,
) -> QueuedOCRResponse:
    """Queue OCR processing and return immediately with a pollable job URL."""
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_content_type",
                "message": (
                    f"Invalid content type: {image.content_type}. "
                    f"Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}"
                ),
            },
        )

    contents = await image.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "empty_image",
                "message": "Uploaded image is empty",
            },
        )

    _validate_image_bytes(contents)

    task_id = tasks.create_task(
        task_type="ocr",
        payload={
            "image_base64": base64.b64encode(contents).decode("ascii"),
            "content_type": image.content_type,
            "filename": image.filename,
            "anchor_metadata": anchor_metadata,
        },
    )

    return QueuedOCRResponse(
        success=True,
        task_id=task_id,
        status="pending",
        message="OCR job queued for processing",
        status_url=f"/v1/ai/jobs/{task_id}",
    )


@router.post(
    "/ai/ocr/batch",
    response_model=BatchOCRResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit(settings.request_rate_limit)
async def process_batch_ocr_endpoint(
    request: Request,
) -> BatchOCRResponse:
    """Process multiple OCR documents in a batch synchronously.
    
    Accepts multipart/form-data with multiple file uploads.
    Each file should have a document_id parameter.
    
    Example: 
        POST /v1/ai/ocr/batch
        Content-Type: multipart/form-data
        
        document_ids[]: doc-001, doc-002
        files[]: <image1>, <image2>
    """
    try:
        form_data = await request.form()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_form_data",
                "message": f"Failed to parse form data: {str(e)}",
            },
        )

    documents = []
    doc_ids = form_data.getlist("document_ids")
    files = form_data.getlist("files")

    if len(files) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_documents",
                "message": "Batch request must contain at least one document",
            },
        )

    if len(doc_ids) != len(files):
        doc_ids = [f"doc-{i}" for i in range(len(files))]

    for idx, file in enumerate(files):
        doc_id = doc_ids[idx] if idx < len(doc_ids) else f"doc-{idx}"

        if not isinstance(file, UploadFile):
            continue

        if file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_content_type",
                    "message": f"Document {doc_id}: Invalid content type {file.content_type}. Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}",
                },
            )

        contents = await file.read()
        if len(contents) == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "empty_image",
                    "message": f"Document {doc_id}: Image file is empty",
                },
            )

        try:
            _validate_image_bytes(contents)
        except HTTPException as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_image",
                    "message": f"Document {doc_id}: {e.detail.get('message', str(e))}",
                },
            )

        documents.append({
            "document_id": doc_id,
            "image_base64": base64.b64encode(contents).decode("ascii"),
            "content_type": file.content_type,
            "filename": file.filename,
        })

    if not documents:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_valid_documents",
                "message": "No valid documents found in batch request",
            },
        )

    result = process_batch_ocr(documents)

    return BatchOCRResponse(
        success=True,
        batch_id=result["batch_id"],
        total_documents=result["total_documents"],
        successful_documents=result["successful_documents"],
        failed_documents=result["failed_documents"],
        results=result["results"],
        total_processing_time_ms=result["total_processing_time_ms"],
    )


@router.post(
    "/ai/ocr/batch/jobs",
    response_model=BatchOCRJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit(settings.request_rate_limit)
async def queue_batch_ocr_job(
    request: Request,
) -> BatchOCRJobResponse:
    """Queue batch OCR processing asynchronously and return immediately with a pollable job URL."""
    try:
        form_data = await request.form()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_form_data",
                "message": f"Failed to parse form data: {str(e)}",
            },
        )

    files = form_data.getlist("files")
    doc_ids = form_data.getlist("document_ids")

    if len(files) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_documents",
                "message": "Batch request must contain at least one document",
            },
        )

    if len(doc_ids) != len(files):
        doc_ids = [f"doc-{i}" for i in range(len(files))]

    documents = []
    for idx, file in enumerate(files):
        doc_id = doc_ids[idx] if idx < len(doc_ids) else f"doc-{idx}"

        if not isinstance(file, UploadFile):
            continue

        if file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_content_type",
                    "message": f"Document {doc_id}: Invalid content type {file.content_type}",
                },
            )

        contents = await file.read()
        if len(contents) == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "empty_image",
                    "message": f"Document {doc_id}: Image file is empty",
                },
            )

        try:
            _validate_image_bytes(contents)
        except HTTPException as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_image",
                    "message": f"Document {doc_id}: Invalid image",
                },
            )

        documents.append({
            "document_id": doc_id,
            "image_base64": base64.b64encode(contents).decode("ascii"),
            "content_type": file.content_type,
            "filename": file.filename,
        })

    if not documents:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_valid_documents",
                "message": "No valid documents found in batch request",
            },
        )

    task_id = tasks.create_task(
        task_type="batch_ocr",
        payload={
            "documents": documents,
        },
    )

    return BatchOCRJobResponse(
        success=True,
        batch_job_id=task_id,
        document_count=len(documents),
        status="pending",
        message="Batch OCR job queued for processing",
        status_url=f"/v1/ai/jobs/{task_id}",
    )


def _validate_image_bytes(contents: bytes) -> None:
    from PIL import Image

    try:
        Image.open(io.BytesIO(contents)).verify()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_image",
                "message": f"Could not decode image: {str(e)}",
            },
        )
