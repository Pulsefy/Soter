import base64
import io
import time
from typing import Optional

from PIL import Image

import metrics
from schemas.common import AnchorMetadata
from schemas.ocr import OCRData, OCRFieldResult
from services.ocr import OCRService

ocr_service = OCRService()

# ensure the default OCR service does not include the test provider
# (test provider is only for unit tests and must never be used in production)
def _remove_test_providers(service):
    try:
        service.providers = [
            p
            for p in service.providers
            if p.__class__.__name__ != "TestProvider"
            and getattr(p, "provider", None) != "test"
        ]
    except AttributeError:
        # If the service does not expose providers, assume it's already correct.
        pass

_remove_test_providers(ocr_service)

# Confidence threshold (0..9). Results below this are flagged for manual review.
LOW_CONFIDENCE_THRESHOLD = 0.8


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
    document_type: Optional[str] = None,
) -> dict:
    start_time = time.time()
    img = Image.open(io.BytesIO(contents))

    start_inference = time.time()
    result = ocr_service.process_image(
        img, language_hint=language_hint, document_type=document_type
    )
    inference_latency = time.time() - start_inference

    metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
    metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}")

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    # Determine if the OCR result should be routed to manual review.
    requires_review = result.requires_review
    review_reasons = list(result.review_reasons or [])

    if result.confidence is None or result.confidence < LOW_CONFIDENCE_THRESHOLD:
        requires_review = True
        if "low_confidence" not in review_reasons:
            review_reasons.append("low_confidence")

    ocr_data = OCRData(
        fields={
            name: OCRFieldResult(value=field.value, confidence=field.confidence)
            for name, field in result.fields.items()
        },
        raw_text=result.raw_text,
        processing_time_ms=processing_time_ms,
        confidence=result.confidence,
        confidence_banding=result.confidence_banding,
        requires_review=requires_review,
        review_reasons=review_reasons,
        document_type=result.document_type,
    )

    response = {
        "success": True,
        "data": ocr_data.model_dump(),
        "processing_time_ms": processing_time_ms,
        "confidence": result.confidence,
        "confidence_banding": result.confidence_banding,
        "requires_review": requires_review,
        "review_reasons": review_reasons,
        "document_type": result.document_type,
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
