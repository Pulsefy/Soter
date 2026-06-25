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


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
) -> dict:
    start_time = time.time()
    img = Image.open(io.BytesIO(contents))

    start_inference = time.time()
    result = ocr_service.process_image(img)
    inference_latency = time.time() - start_inference

    metrics.INFERENCE_LATENCY.labels(task_type="ocr").observe(inference_latency)
    metrics.logger.info(f"OCR Inference completed in {inference_latency:.4f}s")

    processing_time_ms = int((time.time() - start_time) * 1000)
    parsed_metadata = _parse_anchor_metadata(anchor_metadata)

    response = {
        "success": True,
        "data": OCRData(
            fields={
                name: OCRFieldResult(value=field.value, confidence=field.confidence)
                for name, field in result.fields.items()
            },
            raw_text=result.raw_text,
            processing_time_ms=processing_time_ms,
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
) -> dict:
    return run_ocr_from_bytes(base64.b64decode(image_base64), anchor_metadata)


def _parse_anchor_metadata(anchor_metadata: Optional[str]) -> Optional[AnchorMetadata]:
    if not anchor_metadata:
        return None

    try:
        return AnchorMetadata.model_validate_json(anchor_metadata)
    except Exception:
        return None
