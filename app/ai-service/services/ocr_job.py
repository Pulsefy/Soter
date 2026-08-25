import base64
import io
import json
import os
import time
from typing import Optional

from PIL import Image

import metrics
from schemas.common import AnchorMetadata
from schemas.ocr import OCRData, OCRFieldResult
from services.ocr import OCRService

ocr_service = OCRService()


def _get_float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _get_review_threshold(document_type: Optional[str]) -> float:
    if document_type:
        env_name = f"OCR_REVIEW_CONFIDENCE_THRESHOLD_{document_type.upper()}"
        threshold = _get_float_env(env_name, -1.0)
        if threshold >= 0.0:
            return threshold
    return _get_float_env("OCR_REVIEW_CONFIDENCE_THRESHOLD", 0.7)


def _get_high_threshold() -> float:
    return _get_float_env("OCR_HIGH_CONFIDENCE_THRESHOLD", 0.9)


def assess_confidence(
    overall_confidence: Optional[float], document_type: Optional[str] = None
) -> tuple[str, bool]:
    """Return (confidence_band, review_required) for an OCR result."""
    review_threshold = _get_review_threshold(document_type)
    high_threshold = _get_high_threshold()

    if overall_confidence is None:
        return "unknown", True
    if overall_confidence < review_threshold:
        return "low", True
    if overall_confidence < high_threshold:
        return "medium", False
    return "high", False


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
) -> dict:
    start_time = time.time()
    img = Image.open(io.BytesIO(contents))

    document_type = _extract_document_type(anchor_metadata)
    start_inference = time.time()
    result = ocr_service.process_image(img, language_hint=language_hint)
    inference_latency = time.time() - start_inference

    metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
    metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}s")

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    confidences = [field.confidence for field in result.fields.values()]
    overall_confidence = (
        sum(confidences) / len(confidences) if confidences else None
    )
    confidence_band, review_required = assess_confidence(
        overall_confidence, document_type
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
            overall_confidence=overall_confidence,
            confidence_band=confidence_band,
            review_required=review_required,
        ).model_dump(),
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
) -> dict:
    return run_ocr_from_bytes(
        base64.b64decode(image_base64), anchor_metadata, language_hint=language_hint
    )


def _parse_anchor_metadata(anchor_metadata: Optional[str]) -> Optional[AnchorMetadata]:
    if not anchor_metadata:
        return None

    try:
        return AnchorMetadata.model_validate_json(anchor_metadata)
    except Exception:
        return None


def _extract_document_type(anchor_metadata: Optional[str]) -> Optional[str]:
    if not anchor_metadata:
        return None
    try:
        data = json.loads(anchor_metadata)
        if isinstance(data, dict):
            return data.get("document_type")
    except Exception:
        return None
    return None
