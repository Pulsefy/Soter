"""
v1 OCR endpoint.

Extracted from the legacy flat router so the route logic lives in a
single place and is referenced by both the /v1 and the legacy /ai mounts.
"""

import base64
import io
import time
from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

import tasks
from exceptions import LoadShedError
from schemas.ocr import (
    BatchOCRBatchState,
    BatchOCRDocumentState,
    BatchOCRDocumentStatus,
    BatchOCRResponse,
    BatchOCRStatusResponse,
    BatchOCRSummary,
    OCRData,
    LanguageHint,
)
from schemas.common import ResultEnvelope
from services.ocr_confidence import assess_confidence
from services.ocr_job import run_ocr_from_bytes
from services.ocr_batch_store import (
    BatchOCRError,
    OCRBatch,
    OCRBatchDocument,
    ocr_batch_store,
)
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
    anchor_metadata: Annotated[
        Optional[str], Form(description="JSON encoded AnchorMetadata")
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
        raw = run_ocr_from_bytes(
            contents,
            anchor_metadata,
            language_hint=language_hint.value if language_hint else None,
            document_type=document_type,
        )

        from main import correlation_id_var

        ocr_data = (
            OCRData(**raw["data"]) if isinstance(raw["data"], dict) else raw["data"]
        )

        confidence = raw.get("confidence")
        if confidence is None:
            fields = ocr_data.fields
            confidence = (
                round(sum(f.confidence for f in fields.values()) / len(fields), 4)
                if fields
                else None
            )
        needs_review = raw.get("needs_review")
        review_reasons = raw.get("review_reasons")
        if needs_review is None:
            # Defensive fallback for callers that still hand back a bare
            # result dict: derive the banding from the field confidences.
            assessment = assess_confidence(
                [field.confidence for field in ocr_data.fields.values()],
                document_type=document_type,
            )
            needs_review = assessment.needs_review
            review_reasons = assessment.reasons
        reasons = list(review_reasons) if needs_review and review_reasons else None

        return ResultEnvelope[OCRData](
            result=ocr_data,
            confidence=confidence,
            reasons=reasons,
            anchor_metadata=raw.get("anchor_metadata"),
            trace_id=correlation_id_var.get() or None,
        )

    except HTTPException:
        raise
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        # Surface as a structured HTTP error rather than returning a partial envelope
        raise HTTPException(
            status_code=500,
            detail={
                "code": "processing_error",
                "message": str(e),
            },
        )


@router.post(
    "/ai/ocr/batch",
    response_model=BatchOCRResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit(settings.request_rate_limit)
async def queue_batch_ocr_jobs(
    request: Request,
    files: Annotated[
        list[UploadFile], File(description="One or more image files to process")
    ],
    anchor_metadata: Annotated[
        Optional[str], Form(description="JSON encoded AnchorMetadata")
    ] = None,
    language_hint: Annotated[
        Optional[LanguageHint], Form(description="Language hint for OCR")
    ] = None,
) -> BatchOCRResponse:
    """Queue OCR processing for a batch of uploaded document images.

    Every document is tracked on its own: documents that pass validation
    are queued (``pending``), rejected ones come back as ``failed`` with a
    reason, and one bad document never hides a sibling's outcome.  The
    batch-level ``status`` is ``processing`` while jobs are outstanding,
    then ``succeeded``, ``failed`` or ``partially_failed``.  Poll
    ``status_url`` for the per-document breakdown; failed documents expose
    a ``retry_url`` so they can be requeued individually.
    """
    if not files:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "empty_batch",
                "message": "At least one image file is required for batch OCR",
            },
        )

    hint = language_hint.value if language_hint else None
    batch = ocr_batch_store.create_batch(
        anchor_metadata=anchor_metadata, language_hint=hint
    )

    document_statuses: list[BatchOCRDocumentStatus] = []
    for image in files:
        contents: Optional[bytes] = None
        try:
            contents = await image.read()
            task_id = _queue_ocr_document(
                contents,
                image.content_type,
                image.filename,
                batch.anchor_metadata,
                batch.language_hint,
            )
            document = ocr_batch_store.add_document(
                batch.batch_id,
                filename=image.filename,
                status="pending",
                task_id=task_id,
                content_type=image.content_type,
                image_bytes=contents,
            )
        except Exception as exc:
            # A rejected document is recorded as failed (with its reason)
            # and the remaining documents keep being queued.  The upload is
            # retained so the document stays individually retryable.
            document = ocr_batch_store.add_document(
                batch.batch_id,
                filename=image.filename,
                status="failed",
                error=_normalize_error(exc),
                content_type=image.content_type,
                image_bytes=contents,
            )
        document_statuses.append(_document_status(batch.batch_id, document))

    batch_status = _derive_batch_status(
        [document.status for document in batch.documents.values()]
    )
    return BatchOCRResponse(
        success=batch_status != "failed",
        batch_id=batch.batch_id,
        status=batch_status,
        status_url=f"/v1/ai/ocr/batch/{batch.batch_id}",
        summary=_summarize(batch),
        documents=document_statuses,
    )


@router.get(
    "/ai/ocr/batch/{batch_id}",
    response_model=BatchOCRStatusResponse,
)
async def get_batch_ocr_status(batch_id: str) -> BatchOCRStatusResponse:
    """Per-document outcome breakdown for a queued batch.

    Each document reports ``pending``, ``processing``, ``succeeded`` or
    ``failed`` (with the failure reason) - so a caller that submitted ten
    documents where two failed sees exactly which two and why.  The
    batch-level ``status`` is ``processing`` while any document is still
    running, then ``succeeded`` (all succeeded), ``failed`` (all failed) or
    ``partially_failed`` (a mix), keeping a partially failed batch
    distinguishable from the fully failed and fully succeeded cases.
    Failed documents include a ``retry_url`` to requeue them individually.
    """
    batch = _get_batch(batch_id)
    for document in list(batch.documents.values()):
        _refresh_document(batch.batch_id, document)
    return _batch_status_response(batch)


@router.post(
    "/ai/ocr/batch/{batch_id}/documents/{document_id}/retry",
    response_model=BatchOCRStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit(settings.request_rate_limit)
async def retry_batch_ocr_document(
    request: Request,
    batch_id: str,
    document_id: str,
) -> BatchOCRStatusResponse:
    """Requeue a single failed document without resubmitting the batch.

    Only the named document is re-validated and queued again; its siblings
    keep their existing task ids and outcomes.  Returns 404 for an unknown
    batch/document and 409 when the document is not failed or its upload is
    no longer retained.
    """
    batch = _get_batch(batch_id)
    document = _get_document(batch_id, document_id)

    if document.status != "failed":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "document_not_failed",
                "message": (
                    f"Document {document_id} is not failed "
                    f"(status: {document.status})"
                ),
            },
        )
    if document.image_bytes is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "document_not_retryable",
                "message": (
                    "The original upload for this document is no longer "
                    "retained; submit it in a new batch instead"
                ),
            },
        )

    try:
        task_id = _queue_ocr_document(
            document.image_bytes,
            document.content_type,
            document.filename,
            batch.anchor_metadata,
            batch.language_hint,
        )
    except LoadShedError:
        # Server-side overload - leave the stored failure untouched and let
        # the global handler shape the 503 envelope.
        raise
    except Exception as exc:
        # Refresh the stored reason so the batch status shows why the retry
        # did not take, then surface the rejection to the caller.
        error = _normalize_error(exc)
        ocr_batch_store.update_document(
            batch_id, document_id, status="failed", error=error
        )
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=error)

    ocr_batch_store.update_document(
        batch_id, document_id, status="pending", task_id=task_id, error=None
    )
    return _batch_status_response(batch)


@router.post(
    "/ai/ocr/jobs",
    response_model=QueuedOCRResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit(settings.request_rate_limit)
async def queue_ocr_job(
    request: Request,
    image: Annotated[UploadFile, File(description="Image file to process")],
    anchor_metadata: Annotated[
        Optional[str], Form(description="JSON encoded AnchorMetadata")
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
            "language_hint": language_hint.value if language_hint else None,
            "document_type": document_type,
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


# ---------------------------------------------------------------------------
# Batch OCR helpers - shared by submission, status polling and retry so the
# three endpoints always agree on validation, status vocabulary and URLs.
# ---------------------------------------------------------------------------


def _normalize_error(exc: Exception) -> dict[str, str]:
    """Fold an exception into the ``{code, message}`` shape carried on a
    failed document."""
    if isinstance(exc, HTTPException):
        if isinstance(exc.detail, dict):
            return {str(key): str(value) for key, value in exc.detail.items()}
        return {"code": "processing_error", "message": str(exc.detail)}
    if isinstance(exc, BatchOCRError):
        return {"code": exc.code, "message": exc.message}
    return {"code": "processing_error", "message": str(exc)}


def _queue_ocr_document(
    contents: Optional[bytes],
    content_type: Optional[str],
    filename: Optional[str],
    anchor_metadata: Optional[str],
    language_hint: Optional[str],
) -> str:
    """Validate one document and queue its OCR job.

    Raises ``HTTPException`` when the document itself is rejected, so the
    caller records that document's failure without touching its siblings.
    """
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_content_type",
                "message": (
                    f"Invalid content type: {content_type}. "
                    f"Allowed: {', '.join(ALLOWED_CONTENT_TYPES)}"
                ),
            },
        )

    if contents is None or len(contents) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "empty_image",
                "message": "Uploaded image is empty",
            },
        )

    _validate_image_bytes(contents)

    return tasks.create_task(
        task_type="ocr",
        payload={
            "image_base64": base64.b64encode(contents).decode("ascii"),
            "content_type": content_type,
            "filename": filename,
            "anchor_metadata": anchor_metadata,
            "language_hint": language_hint,
        },
    )


def _get_batch(batch_id: str) -> OCRBatch:
    """Fetch a batch, mapping storage misses onto a 404 error envelope."""
    try:
        return ocr_batch_store.get_batch(batch_id)
    except BatchOCRError as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": exc.code, "message": exc.message},
        )


def _get_document(batch_id: str, document_id: str) -> OCRBatchDocument:
    """Fetch one document, mapping storage misses onto a 404 envelope."""
    try:
        return ocr_batch_store.get_document(batch_id, document_id)
    except BatchOCRError as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": exc.code, "message": exc.message},
        )


def _refresh_document(batch_id: str, document: OCRBatchDocument) -> None:
    """Fold the latest job status into the stored per-document outcome.

    Documents that already reached a terminal state are left alone; an
    unavailable status backend (or a task the backend no longer knows
    about) keeps the last known outcome instead of inventing a failure.
    """
    if document.status not in ("pending", "processing"):
        return
    if not document.task_id:
        return

    try:
        info = tasks.get_task_status(document.task_id)
    except Exception:
        return
    if not isinstance(info, dict):
        return

    task_state = info.get("status")
    if task_state == "completed":
        # Terminal success: release the retained upload bytes, since the
        # document is no longer retryable.
        ocr_batch_store.update_document(
            batch_id,
            document.document_id,
            status="succeeded",
            error=None,
            release_payload=True,
        )
    elif task_state == "failed":
        ocr_batch_store.update_document(
            batch_id,
            document.document_id,
            status="failed",
            error={
                "code": "processing_error",
                "message": str(info.get("error") or "OCR job failed"),
            },
        )
    elif task_state in ("cancelled", "expired", "timed_out"):
        ocr_batch_store.update_document(
            batch_id,
            document.document_id,
            status="failed",
            error={
                "code": f"job_{task_state}",
                "message": f"OCR job {task_state.replace('_', ' ')}",
            },
        )
    elif task_state in ("processing", "retrying"):
        ocr_batch_store.update_document(
            batch_id, document.document_id, status="processing"
        )
    # ``pending`` already matches the stored state; ``not_found`` and
    # unknown states are ignored rather than guessed at.


def _document_status(
    batch_id: str, document: OCRBatchDocument
) -> BatchOCRDocumentStatus:
    """Render one stored document as its API representation."""
    return BatchOCRDocumentStatus(
        document_id=document.document_id,
        filename=document.filename,
        status=document.status,
        task_id=document.task_id,
        status_url=f"/v1/ai/jobs/{document.task_id}" if document.task_id else None,
        retry_url=(
            f"/v1/ai/ocr/batch/{batch_id}/documents/{document.document_id}/retry"
            if document.retryable
            else None
        ),
        error=document.error,
    )


def _derive_batch_status(
    statuses: list[BatchOCRDocumentState],
) -> BatchOCRBatchState:
    """Roll per-document outcomes up into a batch-level status.

    A batch with any document still running is ``processing``; only once
    every document reached a terminal state does it become ``succeeded``,
    ``failed`` or ``partially_failed``.  That keeps a partially failed
    batch distinguishable from the fully failed and fully succeeded cases.
    """
    if not statuses:
        # Never report an empty batch as finished.
        return "processing"
    if any(item in ("pending", "processing") for item in statuses):
        return "processing"
    if all(item == "succeeded" for item in statuses):
        return "succeeded"
    if all(item == "failed" for item in statuses):
        return "failed"
    return "partially_failed"


def _summarize(batch: OCRBatch) -> BatchOCRSummary:
    """Count the batch's documents per outcome state."""
    summary = BatchOCRSummary(total=len(batch.documents))
    for document in batch.documents.values():
        if document.status == "pending":
            summary.pending += 1
        elif document.status == "processing":
            summary.processing += 1
        elif document.status == "succeeded":
            summary.succeeded += 1
        else:
            summary.failed += 1
    return summary


def _batch_status_response(batch: OCRBatch) -> BatchOCRStatusResponse:
    """Build the per-document breakdown for a batch."""
    return BatchOCRStatusResponse(
        batch_id=batch.batch_id,
        status=_derive_batch_status(
            [document.status for document in batch.documents.values()]
        ),
        status_url=f"/v1/ai/ocr/batch/{batch.batch_id}",
        summary=_summarize(batch),
        documents=[
            _document_status(batch.batch_id, document)
            for document in batch.documents.values()
        ],
    )
