"""
v1 OCR endpoint.

Extracted from the legacy flat router so the route logic lives in a
single place and is referenced by both the /v1 and the legacy /ai mounts.
"""

import io
import time
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
import metrics
from slowapi import Limiter
from slowapi.util import get_remote_address

from schemas.ocr import OCRData, OCRFieldResult, OCRResponse
from services.ocr import OCRService
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

ocr_service = OCRService()


@router.post("/ai/ocr")
@limiter.limit(settings.request_rate_limit)
async def process_ocr(
    request: Request,
    image: Annotated[UploadFile, File(description="Image file to process")],
    anchor_metadata: Annotated[Optional[str], Form(description="JSON encoded AnchorMetadata")] = None,
) -> OCRResponse:
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

        from PIL import Image

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

        parsed_metadata = None
        if anchor_metadata:
            try:
                from schemas.common import AnchorMetadata
                parsed_metadata = AnchorMetadata.model_validate_json(anchor_metadata)
            except Exception:
                pass

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
            anchor_metadata=parsed_metadata,
        )

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
            anchor_metadata=None, # Cannot easily re-parse here without duplicating, so omit or ignore
        )
