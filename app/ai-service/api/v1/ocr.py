"""
v1 OCR endpoint.

Extracted from the legacy flat router so the route logic lives in a
single place and is referenced by both the /v1 and the legacy /ai mounts.
"""

import base64
import io
import time
import uuid
from typing import Annotated
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

import tasks
from schemas.ocr import OCRResponse
from services.ocr_job import run_ocr_from_bytes
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


@router.post("/ai/ocr")
@limiter.limit(settings.request_rate_limit)
async def process_ocr(
    request: Request,
    image: Annotated[UploadFile, File(description="Image file to process")],
    anchor_metadata: Annotated[Optional[str], Form(description="JSON encoded AnchorMetadata")] = None,
) -> OCRResponse:
    """Extract text fields from an uploaded document image."""
    start_time = time.time()
    trace_id = str(uuid.uuid4())

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
        result = run_ocr_from_bytes(contents, anchor_metadata)

        try:
            img = Image.open(io.BytesIO(contents))
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_image",
                    "message": f"Could not decode image: {str(e)}",
                },
            )

        start_inference = time.time()
        result = ocr_service.process_image(img)
        inference_latency = time.time() - start_inference

        metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
        metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}s")

        processing_time_ms = int((time.time() - start_time) * 1000)

        # Derive top-level confidence as the mean of all extracted field confidences.
        field_confidences = [f.confidence for f in result.fields.values()]
        avg_confidence = (
            sum(field_confidences) / len(field_confidences) if field_confidences else None
        )

        reasons = ["OCR extraction completed successfully"]
        if avg_confidence is not None:
            reasons.append(f"Average field confidence: {avg_confidence:.2f}")

        return OCRResponse(
            success=True,
            data=OCRData(
                fields={
                    name: OCRFieldResult(value=field.value, confidence=field.confidence)
                    for name, field in result.fields.items()
                },
                raw_text=result.raw_text,
                processing_time_ms=processing_time_ms,
            ),
            processing_time_ms=processing_time_ms,
            # Standard result envelope fields (Issue #609)
            result="ocr_complete",
            confidence=avg_confidence,
            reasons=reasons,
            anchor_metadata={
                "filename": image.filename,
                "content_type": image.content_type,
            },
            trace_id=trace_id,
        )
        return OCRResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return OCRResponse(
            success=False,
            error={
                "code": "processing_error",
                "message": str(e),
            },
            processing_time_ms=processing_time_ms,
            # Standard result envelope fields (Issue #609)
            result="ocr_error",
            reasons=[str(e)],
            anchor_metadata={"filename": image.filename},
            trace_id=trace_id,
            anchor_metadata=None, # Cannot easily re-parse here without duplicating, so omit or ignore
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
