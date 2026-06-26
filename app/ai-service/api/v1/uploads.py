"""
Resumable evidence upload session endpoints (v1).

Large verification-evidence files can be uploaded in chunks so that an
interrupted upload resumes from the last received chunk instead of
restarting. Exposes session creation, chunk upload, status, and finalize
routes under the /v1 prefix.
"""

import logging
import os
from typing import Annotated

from fastapi import APIRouter, File, Header, HTTPException, Path, UploadFile

from schemas.uploads import (
    ChunkUploadResponse,
    CreateUploadSessionRequest,
    FinalizeUploadResponse,
    UploadSessionResponse,
)
from services.upload_sessions import (
    UploadSession,
    UploadSessionError,
    UploadSessionService,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["evidence-uploads"])

ALLOWED_EVIDENCE_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "image/tiff",
    "image/bmp",
    "application/pdf",
}

EVIDENCE_UPLOAD_DIR = os.getenv(
    "EVIDENCE_UPLOAD_DIR", "./artifacts/evidence-uploads"
)
EVIDENCE_MAX_UPLOAD_BYTES = int(
    os.getenv("EVIDENCE_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024))
)
EVIDENCE_UPLOAD_SESSION_TTL_SECONDS = int(
    os.getenv("EVIDENCE_UPLOAD_SESSION_TTL_SECONDS", str(60 * 60))
)

upload_session_service = UploadSessionService(
    storage_dir=EVIDENCE_UPLOAD_DIR,
    allowed_content_types=ALLOWED_EVIDENCE_CONTENT_TYPES,
    max_upload_bytes=EVIDENCE_MAX_UPLOAD_BYTES,
    session_ttl_seconds=EVIDENCE_UPLOAD_SESSION_TTL_SECONDS,
)

_ERROR_STATUS = {
    "missing_owner": 401,
    "forbidden_owner": 403,
    "session_not_found": 404,
    "session_expired": 410,
    "invalid_content_type": 415,
    "file_too_large": 413,
    "invalid_chunk_index": 400,
    "invalid_request": 400,
    "empty_chunk": 400,
    "session_already_finalized": 409,
    "incomplete_upload": 409,
    "size_mismatch": 400,
}


def _http_error(exc: UploadSessionError) -> HTTPException:
    status_code = _ERROR_STATUS.get(exc.code, 400)
    return HTTPException(
        status_code=status_code,
        detail={"code": exc.code, "message": exc.message},
    )


def _to_session_response(session: UploadSession) -> UploadSessionResponse:
    return UploadSessionResponse(
        session_id=session.session_id,
        filename=session.filename,
        content_type=session.content_type,
        total_size=session.total_size,
        total_chunks=session.total_chunks,
        received_chunks=UploadSessionService.received_chunks_sorted(session),
        status="completed" if session.completed else "in_progress",
        expires_at=session.expires_at,
        completed=session.completed,
        artifact_id=session.artifact_id,
    )


@router.post("/ai/evidence-uploads/sessions", response_model=UploadSessionResponse)
async def create_upload_session(
    body: CreateUploadSessionRequest,
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """Create a resumable upload session after validating type and size."""
    if body.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "invalid_content_type",
                "message": (
                    f"Invalid content type: {body.content_type}. "
                    f"Allowed: {', '.join(sorted(ALLOWED_EVIDENCE_CONTENT_TYPES))}"
                ),
            },
        )
    try:
        session = upload_session_service.create_session(
            owner_id=x_user_id,
            filename=body.filename,
            content_type=body.content_type,
            total_size=body.total_size,
            total_chunks=body.total_chunks,
        )
    except UploadSessionError as exc:
        raise _http_error(exc)

    logger.info(
        "evidence_upload_session_created",
        extra={
            "event": "evidence_upload_session_created",
            "session_id": session.session_id,
            "owner_id": x_user_id,
        },
    )
    return _to_session_response(session)


@router.put(
    "/ai/evidence-uploads/sessions/{session_id}/chunks/{chunk_index}",
    response_model=ChunkUploadResponse,
)
async def upload_chunk(
    session_id: Annotated[str, Path(min_length=1)],
    chunk_index: Annotated[int, Path(ge=0)],
    chunk: Annotated[UploadFile, File(description="Raw bytes for this chunk")],
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """Upload a single chunk for an existing session."""
    data = await chunk.read()
    try:
        session = upload_session_service.save_chunk(
            session_id=session_id,
            owner_id=x_user_id,
            chunk_index=chunk_index,
            data=data,
        )
    except UploadSessionError as exc:
        raise _http_error(exc)

    received = UploadSessionService.received_chunks_sorted(session)
    return ChunkUploadResponse(
        session_id=session.session_id,
        chunk_index=chunk_index,
        received_chunks=received,
        remaining_chunks=session.total_chunks - len(received),
        status="completed" if session.completed else "in_progress",
    )


@router.get(
    "/ai/evidence-uploads/sessions/{session_id}",
    response_model=UploadSessionResponse,
)
async def get_upload_session(
    session_id: Annotated[str, Path(min_length=1)],
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """Return the current state of an upload session (for resuming)."""
    try:
        session = upload_session_service.get_session(session_id, x_user_id)
    except UploadSessionError as exc:
        raise _http_error(exc)
    return _to_session_response(session)


@router.post(
    "/ai/evidence-uploads/sessions/{session_id}/finalize",
    response_model=FinalizeUploadResponse,
)
async def finalize_upload_session(
    session_id: Annotated[str, Path(min_length=1)],
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """Validate all chunks and ownership, then assemble the final file."""
    try:
        session = upload_session_service.finalize(session_id, x_user_id)
    except UploadSessionError as exc:
        raise _http_error(exc)

    logger.info(
        "evidence_upload_finalized",
        extra={
            "event": "evidence_upload_finalized",
            "session_id": session.session_id,
            "artifact_id": session.artifact_id,
        },
    )
    return FinalizeUploadResponse(
        session_id=session.session_id,
        artifact_id=session.artifact_id or "",
        filename=session.filename,
        content_type=session.content_type,
        total_size=session.total_size,
        status="completed",
    )