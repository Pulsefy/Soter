"""
In-memory registry of batch OCR submissions and their per-document state.

A batch submission (POST /ai/ocr/batch) can mix queued and rejected
documents.  The caller needs a per-document breakdown later - which
documents succeeded, which failed and why, which are still processing -
plus the ability to requeue a single failed document without resubmitting
the whole batch.  That requires the service to remember each document's
identity, its task id, its failure reason, and enough of the original
upload (bytes + content type) to retry it individually.

Storage is in-memory (module-level singleton), matching the pattern already
used for Celery task status in ``tasks.task_results``: batch bookkeeping is
an operational convenience, not a system of record.  Image bytes are
released as soon as a document succeeds, so memory is bounded by the number
of outstanding documents rather than the lifetime of the process.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, Optional

from schemas.ocr import BatchOCRDocumentState

# Distinguishes "leave this field unchanged" from an explicit ``None``.
_UNSET = object()


class BatchOCRError(Exception):
    """Raised for an invalid batch operation.

    ``code`` is a stable, machine-readable identifier that the API layer
    maps to an HTTP status code (``batch_not_found`` and
    ``document_not_found`` both map to 404).
    """

    def __init__(self, code: str, message: Optional[str] = None) -> None:
        self.code = code
        self.message = message or code
        super().__init__(self.message)


@dataclass
class OCRBatchDocument:
    """One document inside a batch and its current outcome."""

    document_id: str
    filename: Optional[str]
    status: BatchOCRDocumentState
    task_id: Optional[str] = None
    error: Optional[Dict[str, str]] = None
    content_type: Optional[str] = None
    # Original upload bytes, kept until the document succeeds so a failed
    # document can be retried individually without resubmitting the batch.
    image_bytes: Optional[bytes] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def retryable(self) -> bool:
        """True when this document is failed and its upload is retained."""
        return self.status == "failed" and self.image_bytes is not None


@dataclass
class OCRBatch:
    """A batch submission and its documents (insertion-ordered)."""

    batch_id: str
    anchor_metadata: Optional[str] = None
    language_hint: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    documents: Dict[str, OCRBatchDocument] = field(default_factory=dict)


class BatchOCRStore:
    """Thread-safe in-memory store for batch OCR submissions."""

    def __init__(self, max_batches: int = 500) -> None:
        self.max_batches = max(1, max_batches)
        self._batches: Dict[str, OCRBatch] = {}
        self._lock = Lock()

    # -- write API ----------------------------------------------------------

    def create_batch(
        self,
        *,
        anchor_metadata: Optional[str] = None,
        language_hint: Optional[str] = None,
    ) -> OCRBatch:
        with self._lock:
            # Bounded retention: evict the oldest batches (insertion order)
            # so an unbounded stream of submissions cannot grow forever.
            while len(self._batches) >= self.max_batches:
                self._batches.pop(next(iter(self._batches)), None)
            batch = OCRBatch(
                batch_id=uuid.uuid4().hex,
                anchor_metadata=anchor_metadata,
                language_hint=language_hint,
            )
            self._batches[batch.batch_id] = batch
            return batch

    def add_document(
        self,
        batch_id: str,
        *,
        filename: Optional[str],
        status: BatchOCRDocumentState,
        task_id: Optional[str] = None,
        error: Optional[Dict[str, str]] = None,
        content_type: Optional[str] = None,
        image_bytes: Optional[bytes] = None,
    ) -> OCRBatchDocument:
        with self._lock:
            batch = self._require_batch(batch_id)
            document = OCRBatchDocument(
                document_id=uuid.uuid4().hex,
                filename=filename,
                status=status,
                task_id=task_id,
                error=error,
                content_type=content_type,
                image_bytes=image_bytes,
            )
            batch.documents[document.document_id] = document
            return document

    def update_document(
        self,
        batch_id: str,
        document_id: str,
        *,
        status: Optional[BatchOCRDocumentState] = None,
        task_id: Optional[str] = None,
        error: object = _UNSET,
        release_payload: bool = False,
    ) -> OCRBatchDocument:
        """Patch a document. ``status``/``task_id`` are only set when given;
        ``error`` is set whenever passed (including ``None`` to clear it);
        ``release_payload`` drops the retained upload bytes.
        """
        with self._lock:
            document = self._require_document(batch_id, document_id)
            if status is not None:
                document.status = status
            if task_id is not None:
                document.task_id = task_id
            if error is not _UNSET:
                document.error = error  # type: ignore[assignment]
            if release_payload:
                document.image_bytes = None
            document.updated_at = time.time()
            return document

    # -- read API -----------------------------------------------------------

    def get_batch(self, batch_id: str) -> OCRBatch:
        with self._lock:
            return self._require_batch(batch_id)

    def get_document(self, batch_id: str, document_id: str) -> OCRBatchDocument:
        with self._lock:
            return self._require_document(batch_id, document_id)

    # -- helpers ------------------------------------------------------------

    def _require_batch(self, batch_id: str) -> OCRBatch:
        batch = self._batches.get(batch_id)
        if batch is None:
            raise BatchOCRError("batch_not_found", f"Batch {batch_id} not found")
        return batch

    def _require_document(self, batch_id: str, document_id: str) -> OCRBatchDocument:
        batch = self._require_batch(batch_id)
        document = batch.documents.get(document_id)
        if document is None:
            raise BatchOCRError(
                "document_not_found",
                f"Document {document_id} not found in batch {batch_id}",
            )
        return document

    def clear(self) -> None:
        """Test helper - drop every batch."""
        with self._lock:
            self._batches.clear()


ocr_batch_store = BatchOCRStore()
