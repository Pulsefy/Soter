import base64
import io
import time
import uuid
from typing import Optional

from PIL import Image

import metrics
from schemas.common import AnchorMetadata
from schemas.ocr import OCRData, OCRFieldResult, BatchOCRDocumentResult
from services.ocr import OCRService


ocr_service = OCRService()


def run_ocr_from_bytes(
    contents: bytes,
    anchor_metadata: Optional[str] = None,
    language_hint: Optional[str] = None,
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
    language_hint: Optional[str] = None,
) -> dict:
    return run_ocr_from_bytes(base64.b64decode(image_base64), anchor_metadata, language_hint=language_hint)


def process_batch_ocr(
    documents: list[dict],
) -> dict:
    """Process multiple OCR documents in a batch.
    
    Args:
        documents: List of dicts with keys:
            - document_id: str (unique identifier)
            - image_base64: str (base64 encoded image)
            - content_type: str (image content type)
            - anchor_metadata: Optional[str] (JSON encoded metadata)
    
    Returns:
        dict with batch results including per-document status
    """
    batch_id = f"batch-{uuid.uuid4().hex[:12]}"
    batch_start_time = time.time()
    
    results = []
    successful_count = 0
    failed_count = 0
    
    for doc in documents:
        doc_start_time = time.time()
        doc_id = doc.get("document_id", f"doc-{len(results)}")
        
        try:
            image_data = base64.b64decode(doc["image_base64"])
            ocr_result = run_ocr_from_bytes(image_data, doc.get("anchor_metadata"))
            
            result = BatchOCRDocumentResult(
                document_id=doc_id,
                success=True,
                data=OCRData(**ocr_result["data"]),
                error=None,
                processing_time_ms=int((time.time() - doc_start_time) * 1000),
            )
            successful_count += 1
            
        except Exception as e:
            result = BatchOCRDocumentResult(
                document_id=doc_id,
                success=False,
                data=None,
                error={
                    "code": "processing_error",
                    "message": str(e),
                },
                processing_time_ms=int((time.time() - doc_start_time) * 1000),
            )
            failed_count += 1
        
        results.append(result)
    
    total_processing_time_ms = int((time.time() - batch_start_time) * 1000)
    
    return {
        "batch_id": batch_id,
        "total_documents": len(documents),
        "successful_documents": successful_count,
        "failed_documents": failed_count,
        "results": [r.model_dump() for r in results],
        "total_processing_time_ms": total_processing_time_ms,
    }


def _parse_anchor_metadata(anchor_metadata: Optional[str]) -> Optional[AnchorMetadata]:
    if not anchor_metadata:
        return None

    try:
        return AnchorMetadata.model_validate_json(anchor_metadata)
    except Exception:
        return None
