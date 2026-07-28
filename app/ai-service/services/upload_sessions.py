"""
Resumable evidence upload session management.

Supports creating upload sessions, receiving file chunks in any order,
tracking session state and expiry, and validating content type, size,
and ownership before assembling the final artifact.

Chunks are persisted to disk per session so that an interrupted upload
can resume from the last successfully received chunk instead of
restarting from zero.
"""

import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set


class UploadSessionError(Exception):
    """Raised when an upload session operation fails.

    ``code`` is a stable, machine-readable identifier that the API layer
    maps to an HTTP status code.
    """

    def __init__(self, code: str, message: Optional[str] = None) -> None:
        self.code = code
        self.message = message or code
        super().__init__(self.code)


@dataclass
class UploadSession:
    """In-memory record describing a single resumable upload."""

    session_id: str
    owner_id: str
    filename: str
    content_type: str
    total_size: int
    total_chunks: int
    created_at: float
    expires_at: float
    received_chunks: Set[int] = field(default_factory=set)
    received_bytes: int = 0
    completed: bool = False
    artifact_id: Optional[str] = None


class UploadSessionService:
    """Manages resumable upload sessions and their on-disk chunks."""

    def __init__(
        self,
        storage_dir: str,
        allowed_content_types: Set[str],
        max_upload_bytes: int,
        session_ttl_seconds: int,
    ) -> None:
        self.storage_dir = storage_dir
        self.allowed_content_types = set(allowed_content_types)
        self.max_upload_bytes = max_upload_bytes
        self.session_ttl_seconds = session_ttl_seconds
        self._sessions: Dict[str, UploadSession] = {}
        self._lock = threading.Lock()
        os.makedirs(self.storage_dir, exist_ok=True)

    # -- internal helpers ----------------------------------------------------

    def _session_dir(self, session_id: str) -> str:
        return os.path.join(self.storage_dir, "sessions", session_id)

    def _chunk_path(self, session_id: str, index: int) -> str:
        return os.path.join(self._session_dir(session_id), f"chunk_{index:06d}.part")

    def _is_expired(self, session: UploadSession) -> bool:
        return time.time() > session.expires_at

    def _purge(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        session_dir = self._session_dir(session_id)
        if os.path.isdir(session_dir):
            shutil.rmtree(session_dir, ignore_errors=True)

    def _require_active_session(self, session_id: str, owner_id: str) -> UploadSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise UploadSessionError("session_not_found")
        if self._is_expired(session):
            self._purge(session_id)
            raise UploadSessionError("session_expired")
        if not owner_id or session.owner_id != owner_id:
            raise UploadSessionError("forbidden_owner")
        return session

    def _recalculate_received_bytes(self, session: UploadSession) -> int:
        total = 0
        for index in session.received_chunks:
            path = self._chunk_path(session.session_id, index)
            if os.path.exists(path):
                total += os.path.getsize(path)
        return total

    # -- public API ----------------------------------------------------------

    def create_session(
        self,
        owner_id: str,
        filename: str,
        content_type: str,
        total_size: int,
        total_chunks: int,
    ) -> UploadSession:
        if not owner_id:
            raise UploadSessionError("missing_owner")
        if content_type not in self.allowed_content_types:
            raise UploadSessionError("invalid_content_type")
        if total_size <= 0 or total_chunks <= 0:
            raise UploadSessionError("invalid_request")
        if total_size > self.max_upload_bytes:
            raise UploadSessionError("file_too_large")

        session_id = uuid.uuid4().hex
        now = time.time()
        session = UploadSession(
            session_id=session_id,
            owner_id=owner_id,
            filename=filename,
            content_type=content_type,
            total_size=total_size,
            total_chunks=total_chunks,
            created_at=now,
            expires_at=now + self.session_ttl_seconds,
        )
        with self._lock:
            self._sessions[session_id] = session
            os.makedirs(self._session_dir(session_id), exist_ok=True)
        return session

    def get_session(self, session_id: str, owner_id: str) -> UploadSession:
        with self._lock:
            return self._require_active_session(session_id, owner_id)

    def save_chunk(
        self,
        session_id: str,
        owner_id: str,
        chunk_index: int,
        data: bytes,
    ) -> UploadSession:
        with self._lock:
            session = self._require_active_session(session_id, owner_id)
            if session.completed:
                raise UploadSessionError("session_already_finalized")
            if chunk_index < 0 or chunk_index >= session.total_chunks:
                raise UploadSessionError("invalid_chunk_index")
            if not data:
                raise UploadSessionError("empty_chunk")

            chunk_path = self._chunk_path(session_id, chunk_index)
            with open(chunk_path, "wb") as handle:
                handle.write(data)
            session.received_chunks.add(chunk_index)
            session.received_bytes = self._recalculate_received_bytes(session)

            if session.received_bytes > self.max_upload_bytes:
                # Roll back the chunk that pushed us over the limit.
                os.remove(chunk_path)
                session.received_chunks.discard(chunk_index)
                session.received_bytes = self._recalculate_received_bytes(session)
                raise UploadSessionError("file_too_large")

            return session

    def finalize(self, session_id: str, owner_id: str) -> UploadSession:
        with self._lock:
            session = self._require_active_session(session_id, owner_id)
            if session.completed:
                return session

            missing = [
                index
                for index in range(session.total_chunks)
                if index not in session.received_chunks
            ]
            if missing:
                raise UploadSessionError("incomplete_upload")

            if session.received_bytes != session.total_size:
                raise UploadSessionError("size_mismatch")

            safe_name = os.path.basename(session.filename) or "artifact"
            artifact_id = uuid.uuid4().hex
            artifact_path = os.path.join(
                self.storage_dir, f"{artifact_id}_{safe_name}"
            )
            with open(artifact_path, "wb") as output:
                for index in range(session.total_chunks):
                    with open(self._chunk_path(session_id, index), "rb") as part:
                        shutil.copyfileobj(part, output)

            session.completed = True
            session.artifact_id = artifact_id
            shutil.rmtree(self._session_dir(session_id), ignore_errors=True)
            return session

    @staticmethod
    def received_chunks_sorted(session: UploadSession) -> List[int]:
        return sorted(session.received_chunks)