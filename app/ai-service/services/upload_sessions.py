"""
Resumable evidence upload session management.

Supports creating upload sessions, receiving file chunks in any order,
tracking session state and expiry, and validating content type, size,
ownership, and integrity before assembling the final artifact.

Per-chunk SHA-256 checksums are verified on receipt so that a corrupted
or replayed chunk is rejected immediately rather than silently assembled
into the artifact.  The assembled artifact's SHA-256 is always returned
on finalization.  If the caller declares an ``expected_artifact_checksum``
at session-creation time the finalized artifact is verified against it
before being accepted, so a partially-corrupted resumed upload is caught
at completion even when each individual chunk passed its own check.

Chunks are persisted to disk per session so that an interrupted upload
can resume from the last successfully received chunk instead of
restarting from zero.
"""

import hashlib
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
    # Maps chunk_index -> declared SHA-256 hex checksum for idempotency checks.
    chunk_checksums: Dict[int, str] = field(default_factory=dict)
    received_bytes: int = 0
    completed: bool = False
    artifact_id: Optional[str] = None
    artifact_checksum: Optional[str] = None
    # If set at creation time, finalize must verify the assembled artifact
    # against this value before accepting the upload.
    expected_artifact_checksum: Optional[str] = None


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

    @staticmethod
    def _sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    # -- public API ----------------------------------------------------------

    def create_session(
        self,
        owner_id: str,
        filename: str,
        content_type: str,
        total_size: int,
        total_chunks: int,
        expected_artifact_checksum: Optional[str] = None,
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
            expected_artifact_checksum=expected_artifact_checksum,
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
        checksum: Optional[str] = None,
    ) -> UploadSession:
        """Store a chunk after verifying its SHA-256 checksum.

        Args:
            session_id:   Active session identifier.
            owner_id:     Must match the session owner.
            chunk_index:  Zero-based index; must be in ``[0, total_chunks)``.
            data:         Raw chunk bytes.
            checksum:     Client-supplied SHA-256 hex digest of *data*.
                          When provided, the server recomputes the digest and
                          rejects the chunk if they differ.  Callers should
                          always supply this to enable corruption detection.

        Raises:
            UploadSessionError("chunk_checksum_mismatch") when the declared
            checksum does not match the received bytes.
            UploadSessionError("chunk_index_conflict") when the same index was
            previously accepted with a different checksum, indicating a
            corrupted resume attempt.
        """
        with self._lock:
            session = self._require_active_session(session_id, owner_id)
            if session.completed:
                raise UploadSessionError("session_already_finalized")
            if chunk_index < 0 or chunk_index >= session.total_chunks:
                raise UploadSessionError("invalid_chunk_index")
            if not data:
                raise UploadSessionError("empty_chunk")

            # --- per-chunk integrity check ----------------------------------
            actual_checksum = self._sha256(data)
            if checksum is not None and actual_checksum != checksum:
                raise UploadSessionError(
                    "chunk_checksum_mismatch",
                    f"Chunk {chunk_index}: declared checksum {checksum!r} does not "
                    f"match computed {actual_checksum!r}.",
                )

            # --- idempotency / resume conflict check ------------------------
            if chunk_index in session.received_chunks:
                prior = session.chunk_checksums.get(chunk_index)
                if prior and prior != actual_checksum:
                    raise UploadSessionError(
                        "chunk_index_conflict",
                        f"Chunk {chunk_index} was previously accepted with a "
                        f"different checksum ({prior!r} vs {actual_checksum!r}). "
                        "Resume sequence is corrupted.",
                    )
                # Exact duplicate — idempotent accept, no re-write.
                return session

            chunk_path = self._chunk_path(session_id, chunk_index)
            with open(chunk_path, "wb") as handle:
                handle.write(data)
            session.received_chunks.add(chunk_index)
            session.chunk_checksums[chunk_index] = actual_checksum
            session.received_bytes = self._recalculate_received_bytes(session)

            if session.received_bytes > self.max_upload_bytes:
                # Roll back the chunk that pushed us over the limit.
                os.remove(chunk_path)
                session.received_chunks.discard(chunk_index)
                session.chunk_checksums.pop(chunk_index, None)
                session.received_bytes = self._recalculate_received_bytes(session)
                raise UploadSessionError("file_too_large")

            return session

    def finalize(self, session_id: str, owner_id: str) -> UploadSession:
        """Assemble all chunks into the final artifact and verify integrity.

        After concatenation the artifact's SHA-256 is computed and stored on
        the session.  If an ``expected_artifact_checksum`` was declared at
        session-creation time the artifact is verified against it; a mismatch
        raises ``UploadSessionError("artifact_checksum_mismatch")`` and the
        incomplete artifact file is removed so no corrupt data persists.
        """
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

            # --- assemble and hash in a single streaming pass ---------------
            hasher = hashlib.sha256()
            try:
                with open(artifact_path, "wb") as output:
                    for index in range(session.total_chunks):
                        with open(self._chunk_path(session_id, index), "rb") as part:
                            chunk_data = part.read()
                            output.write(chunk_data)
                            hasher.update(chunk_data)
            except Exception:
                # Clean up partial artifact on any I/O failure.
                if os.path.exists(artifact_path):
                    os.remove(artifact_path)
                raise

            artifact_checksum = hasher.hexdigest()

            # --- verify against declared artifact checksum ------------------
            if (
                session.expected_artifact_checksum is not None
                and artifact_checksum != session.expected_artifact_checksum
            ):
                os.remove(artifact_path)
                raise UploadSessionError(
                    "artifact_checksum_mismatch",
                    f"Assembled artifact checksum {artifact_checksum!r} does not "
                    f"match expected {session.expected_artifact_checksum!r}. "
                    "The upload may have been corrupted during transmission.",
                )

            session.completed = True
            session.artifact_id = artifact_id
            session.artifact_checksum = artifact_checksum
            shutil.rmtree(self._session_dir(session_id), ignore_errors=True)
            return session

    @staticmethod
    def received_chunks_sorted(session: UploadSession) -> List[int]:
        return sorted(session.received_chunks)
