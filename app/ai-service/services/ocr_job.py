import base64
import io
import time
from typing import Optional

from PIL import Image

import metrics
from schemas.common import AnchorMetadata
from schemas.ocr import OCRData, OCRFieldResult, MultiPageOCRData, OCRPageFieldResult
from services.ocr import OCRService
from services.ocr_confidence import assess_confidence

ocr_service = OCRService()


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    start_time = time.time()
    img = Image.open(io.BytesIO(contents))

    start_inference = time.time()
    result = ocr_service.process_image(img, language_hint=language_hint)
    inference_latency = time.time() - start_inference

    metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
    metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}s")

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    # Band the extraction so a low-confidence document can be routed to a
    # human instead of being treated as authoritative (issue #984).
    assessment = assess_confidence(
        [field.confidence for field in result.fields.values()],
        document_type=document_type,
    )

    response = {
        "success": True,
        "data": OCRData(
            fields={
                name: OCRFieldResult(value=field.value, confidence=field.confidence)
                for name, field in result.fields.items()
            },
            raw_text=result.raw_text,
            processing_time_ms=processing_time_ms,
            confidence=assessment.confidence,
            confidence_band=assessment.band,
            needs_review=assessment.needs_review,
            review_threshold=assessment.review_threshold,
            document_type=document_type,
        ).model_dump(mode="json"),
        # Surfaced at the top level as well so the flag is unmistakably
        # present in the callback payload sent to the backend.
        "confidence": assessment.confidence,
        "confidence_band": assessment.band.value,
        "needs_review": assessment.needs_review,
        "review_threshold": assessment.review_threshold,
        "document_type": document_type,
        "review_reasons": assessment.reasons,
        "processing_time_ms": processing_time_ms,
        "anchor_metadata": (
            parsed_metadata.model_dump() if parsed_metadata is not None else None
        ),
    }
    return response


def run_ocr_from_base64(
    image_base64: str,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    return run_ocr_from_bytes(
        base64.b64decode(image_base64),
        anchor_metadata,
        language_hint=language_hint,
        document_type=document_type,
    )


def _parse_anchor_metadata(anchor_metadata: Optional[str]) -> Optional[AnchorMetadata]:
    if not anchor_metadata:
        return None

    try:
        return AnchorMetadata.model_validate_json(anchor_metadata)
    except Exception:
        return None


def stitch_multipage_ocr(
    pages: list[bytes],
    logical_document_id: str,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    """Process multiple page images as one logical document.

    Each page is OCR-processed independently. Fields are then merged across
    pages: when the same field appears on multiple pages the highest-confidence
    value wins. Every merged field retains a ``page`` attribute so callers can
    trace which page each value came from.

    Returns a dict shaped like the other ocr_job helpers, with ``data`` holding
    a :class:`~schemas.ocr.MultiPageOCRData` instance serialised to a plain dict.
    """
    start_time = time.time()

    # Per-page raw results -------------------------------------------------
    page_results: list[dict] = []
    for page_bytes in pages:
        img = Image.open(io.BytesIO(page_bytes))
        start_inference = time.time()
        result = ocr_service.process_image(img, language_hint=language_hint)
        inference_latency = time.time() - start_inference
        metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
        page_results.append(
            {
                "fields": result.fields,  # dict[str, FieldMatch]
                "raw_text": result.raw_text,
            }
        )

    # Stitch: merge fields, keeping highest-confidence value per field -------
    merged: dict[str, OCRPageFieldResult] = {}
    raw_text_by_page: dict[int, str] = {}

    for page_index, page_data in enumerate(page_results):
        page_number = page_index + 1  # 1-based
        raw_text_by_page[page_number] = page_data["raw_text"]

        for field_name, field_match in page_data["fields"].items():
            existing = merged.get(field_name)
            if existing is None or field_match.confidence > existing.confidence:
                merged[field_name] = OCRPageFieldResult(
                    value=field_match.value,
                    confidence=field_match.confidence,
                    page=page_number,
                )

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    assessment = assess_confidence(
        [f.confidence for f in merged.values()],
        document_type=document_type,
    )

    data = MultiPageOCRData(
        logical_document_id=logical_document_id,
        page_count=len(pages),
        fields=merged,
        raw_text_by_page=raw_text_by_page,
        processing_time_ms=processing_time_ms,
        confidence=assessment.confidence,
        confidence_band=assessment.band,
        needs_review=assessment.needs_review,
        review_threshold=assessment.review_threshold,
        document_type=document_type,
    )

    return {
        "success": True,
        "data": data.model_dump(mode="json"),
        "confidence": assessment.confidence,
        "confidence_band": assessment.band.value,
        "needs_review": assessment.needs_review,
        "review_threshold": assessment.review_threshold,
        "document_type": document_type,
        "review_reasons": assessment.reasons,
        "processing_time_ms": processing_time_ms,
        "anchor_metadata": (
            parsed_metadata.model_dump() if parsed_metadata is not None else None
        ),
    }
