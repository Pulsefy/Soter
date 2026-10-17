import base64
import io
import time
from typing import Optional

from PIL import Image

import metrics
from schemas.common import AnchorMetadata
from schemas.ocr import OCRData, OCRFieldResult, OCRPageData
from services.ocr import OCRService
from services.ocr_confidence import assess_confidence

ocr_service = OCRService()


def run_multipage_ocr_from_bytes(
    pages_contents: list[bytes],
    document_id: Optional[str] = None,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    start_time = time.time()
    images = [Image.open(io.BytesIO(c)) for c in pages_contents]

    start_inference = time.time()
    result = ocr_service.process_document_pages(
        images, document_id=document_id, language_hint=language_hint
    )
    inference_latency = time.time() - start_inference

    metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
    metrics.logger.info(
        f"Multi-page OCR Inference completed for {len(images)} pages in {inference_latency:.4f}s"
    )

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    assessment = assess_confidence(
        [field.confidence for field in result.fields.values()],
        document_type=document_type,
    )

    needs_review = assessment.needs_review
    reasons = list(assessment.reasons) if assessment.reasons else []

    # If conflicting extractions were detected across pages, enforce manual review
    if result.conflicts:
        needs_review = True
        if result.conflict_reasons:
            for cr in result.conflict_reasons:
                if cr not in reasons:
                    reasons.append(cr)

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
        for pr in (result.pages or [])
    ]

    conflicts_data = (
        {
            name: [
                OCRFieldResult(value=f.value, confidence=f.confidence, page=f.page)
                for f in f_list
            ]
            for name, f_list in result.conflicts.items()
        }
        if result.conflicts
        else None
    )

    data_payload = OCRData(
        document_id=result.document_id,
        page_count=result.page_count,
        fields={
            name: OCRFieldResult(
                value=field.value,
                confidence=field.confidence,
                page=field.page,
            )
            for name, field in result.fields.items()
        },
        raw_text=result.raw_text,
        processing_time_ms=processing_time_ms,
        confidence=assessment.confidence,
        confidence_band=assessment.band,
        needs_review=needs_review,
        review_threshold=assessment.review_threshold,
        document_type=document_type,
        conflicts=conflicts_data,
        pages=pages_data if pages_data else None,
    ).model_dump(mode="json")

    return {
        "success": True,
        "data": data_payload,
        "confidence": assessment.confidence,
        "confidence_band": assessment.band.value if assessment.band else None,
        "needs_review": needs_review,
        "review_threshold": assessment.review_threshold,
        "document_type": document_type,
        "review_reasons": reasons if reasons else None,
        "processing_time_ms": processing_time_ms,
        "anchor_metadata": (
            parsed_metadata.model_dump() if parsed_metadata is not None else None
        ),
    }


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
    document_id: Optional[str] = None,
) -> dict:
    return run_multipage_ocr_from_bytes(
        [contents],
        document_id=document_id,
        anchor_metadata=anchor_metadata,
        language_hint=language_hint,
        document_type=document_type,
    )


def run_multipage_ocr_from_base64(
    pages_base64: list[str],
    document_id: Optional[str] = None,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    return run_multipage_ocr_from_bytes(
        [base64.b64decode(b) for b in pages_base64],
        document_id=document_id,
        anchor_metadata=anchor_metadata,
        language_hint=language_hint,
        document_type=document_type,
    )


def run_ocr_from_base64(
    image_base64: str,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
    document_id: Optional[str] = None,
) -> dict:
    return run_ocr_from_bytes(
        base64.b64decode(image_base64),
        anchor_metadata,
        language_hint=language_hint,
        document_type=document_type,
        document_id=document_id,
    )


def _parse_anchor_metadata(anchor_metadata: Optional[str]) -> Optional[AnchorMetadata]:
    if not anchor_metadata:
        return None

    try:
        return AnchorMetadata.model_validate_json(anchor_metadata)
    except Exception:
        return None
