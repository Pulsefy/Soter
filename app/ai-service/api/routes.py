import io
import time
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
import metrics
from slowapi import Limiter
from slowapi.util import get_remote_address

import re
import uuid
from schemas.ocr import (
    OCRData,
    OCRFieldResult,
    OCRPageData,
    OCRResponse,
    LanguageHint,
)
from services.ocr import OCRService
from services.ocr_confidence import assess_confidence
from config import settings

router = APIRouter(tags=["ai"])
limiter = Limiter(key_func=get_remote_address)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/bmp",
    "image/tiff",
    "image/webp",
}

DOCUMENT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+$")


def _validate_document_id(document_id: Optional[str]) -> Optional[str]:
    if document_id is None:
        return None
    doc_id = document_id.strip()
    if not doc_id:
        return None
    if len(doc_id) > 128 or not DOCUMENT_ID_PATTERN.match(doc_id):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_document_id",
                "message": (
                    f"Invalid document_id '{document_id}'. Must be 1-128 alphanumeric, "
                    "underscore, dash, or dot characters."
                ),
            },
        )
    return doc_id


ocr_service = OCRService()


@router.post("/ai/ocr")
@limiter.limit(settings.request_rate_limit)
async def process_ocr(
    request: Request,
    image: Optional[UploadFile] = File(
        None, description="Single image file to process"
    ),
    pages: list[UploadFile] = File(
        default=[],
        description="Multiple page images belonging to one logical document",
    ),
    document_id: Annotated[
        Optional[str],
        Form(description="Logical document identifier grouping the pages"),
    ] = None,
    language_hint: Annotated[
        Optional[LanguageHint], Form(description="Language hint for OCR")
    ] = None,
    document_type: Annotated[
        Optional[str],
        Form(
            description=(
                "Optional document type (e.g. id_card, passport) used to pick "
                "a per-document-type review threshold"
            )
        ),
    ] = None,
) -> OCRResponse:
    upload_pages: list[UploadFile] = []
    if image is not None:
        upload_pages.append(image)
    if pages:
        upload_pages.extend(pages)

    if not upload_pages:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "missing_image",
                "message": "At least one image file is required ('image' or 'pages')",
            },
        )

    validated_doc_id = _validate_document_id(document_id)
    if not validated_doc_id and len(upload_pages) > 1:
        validated_doc_id = f"doc-{uuid.uuid4().hex[:12]}"

    start_time = time.time()

    for idx, page_file in enumerate(upload_pages):
        page_num = idx + 1
        if page_file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_content_type",
                    "message": f"Invalid content type: {page_file.content_type}. Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}",
                },
            )

    try:
        from PIL import Image

        page_images: list[Image.Image] = []
        for idx, page_file in enumerate(upload_pages):
            page_num = idx + 1
            contents = await page_file.read()

            if len(contents) == 0:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "empty_image",
                        "message": (
                            f"Uploaded image for page {page_num} is empty"
                            if len(upload_pages) > 1
                            else "Uploaded image is empty"
                        ),
                    },
                )

            try:
                img = Image.open(io.BytesIO(contents))
                img.verify()
                # Re-open after verify() since verify() can invalidate the stream
                img = Image.open(io.BytesIO(contents))
                page_images.append(img)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "invalid_image",
                        "message": f"Could not decode image: {str(e)}",
                    },
                )

        start_inference = time.time()
        if len(page_images) == 1:
            result = ocr_service.process_image(
                page_images[0],
                language_hint=language_hint.value if language_hint else None,
            )
            inference_latency = time.time() - start_inference
            metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
            metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}s")
            processing_time_ms = int((time.time() - start_time) * 1000)

            assessment = assess_confidence(
                [field.confidence for field in result.fields.values()],
                document_type=document_type,
            )

            fields_data = {
                name: OCRFieldResult(
                    value=field.value,
                    confidence=field.confidence,
                    page=1,
                )
                for name, field in result.fields.items()
            }

            return OCRResponse(
                success=True,
                data=OCRData(
                    document_id=validated_doc_id,
                    page_count=1,
                    fields=fields_data,
                    raw_text=result.raw_text,
                    processing_time_ms=processing_time_ms,
                    confidence=assessment.confidence,
                    confidence_band=assessment.band,
                    needs_review=assessment.needs_review,
                    review_threshold=assessment.review_threshold,
                    document_type=document_type,
                    pages=[
                        OCRPageData(
                            page=1,
                            raw_text=result.raw_text,
                            fields=fields_data,
                            confidence=assessment.confidence,
                        )
                    ],
                ),
                processing_time_ms=processing_time_ms,
            )
        else:
            multi_result = ocr_service.process_document_pages(
                page_images,
                document_id=validated_doc_id,
                language_hint=language_hint.value if language_hint else None,
            )
            inference_latency = time.time() - start_inference
            metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
            metrics.logger.info(
                f"Multi-page OCR Inference completed for {len(page_images)} pages in {inference_latency:.4f}s"
            )
            processing_time_ms = int((time.time() - start_time) * 1000)

            assessment = assess_confidence(
                [field.confidence for field in multi_result.fields.values()],
                document_type=document_type,
            )
            needs_review = assessment.needs_review
            if multi_result.conflicts:
                needs_review = True

            pages_data = [
                OCRPageData(
                    page=pr.page,
                    raw_text=pr.raw_text,
                    fields={
                        name: OCRFieldResult(
                            value=f.value, confidence=f.confidence, page=f.page
                        )
                        for name, f in pr.fields.items()
                    },
                    confidence=pr.confidence,
                )
                for pr in (multi_result.pages or [])
            ]

            conflicts_data = (
                {
                    name: [
                        OCRFieldResult(
                            value=f.value, confidence=f.confidence, page=f.page
                        )
                        for f in f_list
                    ]
                    for name, f_list in multi_result.conflicts.items()
                }
                if multi_result.conflicts
                else None
            )

            return OCRResponse(
                success=True,
                data=OCRData(
                    document_id=multi_result.document_id,
                    page_count=multi_result.page_count,
                    fields={
                        name: OCRFieldResult(
                            value=field.value,
                            confidence=field.confidence,
                            page=field.page,
                        )
                        for name, field in multi_result.fields.items()
                    },
                    raw_text=multi_result.raw_text,
                    processing_time_ms=processing_time_ms,
                    confidence=assessment.confidence,
                    confidence_band=assessment.band,
                    needs_review=needs_review,
                    review_threshold=assessment.review_threshold,
                    document_type=document_type,
                    conflicts=conflicts_data,
                    pages=pages_data if pages_data else None,
                ),
                processing_time_ms=processing_time_ms,
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
        )


@router.post("/ai/ocr/multi-page")
@limiter.limit(settings.request_rate_limit)
async def process_multipage_ocr(
    request: Request,
    pages: Annotated[
        list[UploadFile],
        File(description="Two or more page images belonging to one logical document"),
    ],
    document_id: Annotated[
        Optional[str],
        Form(description="Logical document identifier grouping the pages"),
    ] = None,
    language_hint: Annotated[
        Optional[LanguageHint], Form(description="Language hint for OCR")
    ] = None,
    document_type: Annotated[
        Optional[str],
        Form(
            description=(
                "Optional document type (e.g. id_card, passport) used to pick "
                "a per-document-type review threshold"
            )
        ),
    ] = None,
) -> OCRResponse:
    """Extract and aggregate text fields across multiple pages of a single logical document."""
    return await process_ocr(
        request=request,
        image=None,
        pages=pages,
        document_id=document_id,
        language_hint=language_hint,
        document_type=document_type,
    )
