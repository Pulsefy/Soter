"""
Tests for the resumable evidence upload session service.
"""

import hashlib
import os

import pytest

from services.upload_sessions import UploadSessionError, UploadSessionService

ALLOWED_TYPES = {"image/png", "application/pdf"}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _make_service(tmp_path, ttl_seconds=3600, max_bytes=1024):
    return UploadSessionService(
        storage_dir=str(tmp_path / "uploads"),
        allowed_content_types=ALLOWED_TYPES,
        max_upload_bytes=max_bytes,
        session_ttl_seconds=ttl_seconds,
    )


def test_create_upload_and_finalize_in_order(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session(
        owner_id="user-1",
        filename="evidence.png",
        content_type="image/png",
        total_size=6,
        total_chunks=3,
    )

    # Upload out of order to prove the service reassembles by index.
    service.save_chunk(session.session_id, "user-1", 2, b"cc")
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    service.save_chunk(session.session_id, "user-1", 1, b"bb")

    finalized = service.finalize(session.session_id, "user-1")
    assert finalized.completed is True
    assert finalized.artifact_id

    artifact_path = os.path.join(
        service.storage_dir, f"{finalized.artifact_id}_evidence.png"
    )
    with open(artifact_path, "rb") as handle:
        assert handle.read() == b"aabbcc"


def test_finalize_requires_all_chunks_then_resumes(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 4, 2)

    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    with pytest.raises(UploadSessionError) as exc_info:
        service.finalize(session.session_id, "user-1")
    assert exc_info.value.code == "incomplete_upload"

    # Resume by sending the missing chunk, then finalize succeeds.
    service.save_chunk(session.session_id, "user-1", 1, b"bb")
    finalized = service.finalize(session.session_id, "user-1")
    assert finalized.completed is True


def test_rejects_invalid_content_type(tmp_path):
    service = _make_service(tmp_path)
    with pytest.raises(UploadSessionError) as exc_info:
        service.create_session(
            "user-1", "bad.exe", "application/x-msdownload", 4, 1
        )
    assert exc_info.value.code == "invalid_content_type"


def test_rejects_file_larger_than_limit(tmp_path):
    service = _make_service(tmp_path, max_bytes=10)
    with pytest.raises(UploadSessionError) as exc_info:
        service.create_session("user-1", "e.png", "image/png", 50, 1)
    assert exc_info.value.code == "file_too_large"


def test_enforces_size_limit_across_chunks(tmp_path):
    service = _make_service(tmp_path, max_bytes=3)
    session = service.create_session("user-1", "e.png", "image/png", 3, 2)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    with pytest.raises(UploadSessionError) as exc_info:
        service.save_chunk(session.session_id, "user-1", 1, b"bb")
    assert exc_info.value.code == "file_too_large"


def test_enforces_ownership(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    with pytest.raises(UploadSessionError) as exc_info:
        service.save_chunk(session.session_id, "intruder", 0, b"aa")
    assert exc_info.value.code == "forbidden_owner"


def test_expired_session_is_rejected(tmp_path):
    service = _make_service(tmp_path, ttl_seconds=-1)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    with pytest.raises(UploadSessionError) as exc_info:
        service.get_session(session.session_id, "user-1")
    assert exc_info.value.code == "session_expired"


def test_finalize_detects_size_mismatch(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 10, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    with pytest.raises(UploadSessionError) as exc_info:
        service.finalize(session.session_id, "user-1")
    assert exc_info.value.code == "size_mismatch"


# ===========================================================================
# Per-chunk checksum verification
# ===========================================================================

class TestChunkChecksumVerification:
    """Per-chunk SHA-256 integrity checks."""

    def test_accepts_chunk_with_correct_checksum(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 4, 2)
        data = b"ab"
        result = service.save_chunk(
            session.session_id, "u1", 0, data, checksum=_sha256(data)
        )
        assert 0 in result.received_chunks

    def test_rejects_chunk_with_wrong_checksum(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 4, 2)
        with pytest.raises(UploadSessionError) as exc_info:
            service.save_chunk(
                session.session_id, "u1", 0, b"ab", checksum="deadbeef" * 8
            )
        assert exc_info.value.code == "chunk_checksum_mismatch"

    def test_accepts_chunk_without_checksum(self, tmp_path):
        """Checksum is optional; omitting it still stores the chunk."""
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 2, 1)
        result = service.save_chunk(session.session_id, "u1", 0, b"ab")
        assert 0 in result.received_chunks

    def test_server_records_computed_checksum(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 2, 1)
        data = b"xy"
        service.save_chunk(session.session_id, "u1", 0, data)
        assert session.chunk_checksums[0] == _sha256(data)

    def test_corrupt_checksum_does_not_persist_chunk_to_disk(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 2, 1)
        chunk_path = service._chunk_path(session.session_id, 0)
        with pytest.raises(UploadSessionError):
            service.save_chunk(
                session.session_id, "u1", 0, b"xy", checksum="badhash"
            )
        # File must not be left on disk after a rejected chunk
        assert not os.path.exists(chunk_path)


# ===========================================================================
# Resume flow: corrupted chunk sequence detection
# ===========================================================================

class TestResumeCorruptionDetection:
    """Ensure a re-uploaded chunk with a different checksum is rejected."""

    def test_idempotent_re_upload_of_same_chunk_accepted(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 4, 2)
        data = b"aa"
        service.save_chunk(session.session_id, "u1", 0, data, checksum=_sha256(data))
        # Sending the same chunk again should be a no-op
        result = service.save_chunk(
            session.session_id, "u1", 0, data, checksum=_sha256(data)
        )
        assert result.received_chunks == {0}

    def test_re_upload_with_different_data_raises_conflict(self, tmp_path):
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 4, 2)
        service.save_chunk(session.session_id, "u1", 0, b"aa")
        # Different bytes for the same index → corrupted resume
        with pytest.raises(UploadSessionError) as exc_info:
            service.save_chunk(session.session_id, "u1", 0, b"bb")
        assert exc_info.value.code == "chunk_index_conflict"

    def test_re_upload_with_mismatched_declared_checksum_rejected(self, tmp_path):
        """Client sends correct bytes but a checksum that doesn't match them."""
        service = _make_service(tmp_path)
        session = service.create_session("u1", "f.png", "image/png", 2, 1)
        good_data = b"ok"
        bad_checksum = _sha256(b"not-ok")
        with pytest.raises(UploadSessionError) as exc_info:
            service.save_chunk(
                session.session_id, "u1", 0, good_data, checksum=bad_checksum
            )
        assert exc_info.value.code == "chunk_checksum_mismatch"


# ===========================================================================
# Artifact-level integrity on finalize (happy path)
# ===========================================================================

class TestArtifactChecksumHappyPath:
    """finalize() computes and stores the artifact checksum."""

    def test_finalize_stores_artifact_checksum(self, tmp_path):
        service = _make_service(tmp_path)
        payload = b"hello world"
        session = service.create_session(
            "u1", "f.png", "image/png", len(payload), 1
        )
        service.save_chunk(session.session_id, "u1", 0, payload)
        finalized = service.finalize(session.session_id, "u1")
        assert finalized.artifact_checksum == _sha256(payload)

    def test_finalize_correct_declared_checksum_passes(self, tmp_path):
        service = _make_service(tmp_path)
        payload = b"chunk0" + b"chunk1"
        expected = _sha256(payload)
        session = service.create_session(
            "u1", "f.png", "image/png", len(payload), 2,
            expected_artifact_checksum=expected,
        )
        service.save_chunk(session.session_id, "u1", 0, b"chunk0")
        service.save_chunk(session.session_id, "u1", 1, b"chunk1")
        finalized = service.finalize(session.session_id, "u1")
        assert finalized.artifact_checksum == expected

    def test_finalize_without_declared_checksum_succeeds(self, tmp_path):
        """No expected_artifact_checksum → finalize always succeeds on size match."""
        service = _make_service(tmp_path)
        payload = b"data"
        session = service.create_session("u1", "f.png", "image/png", 4, 1)
        service.save_chunk(session.session_id, "u1", 0, payload)
        finalized = service.finalize(session.session_id, "u1")
        assert finalized.completed is True
        assert finalized.artifact_checksum is not None

    def test_artifact_checksum_matches_raw_assembled_content(self, tmp_path):
        """Server checksum must equal sha256(concat(chunks in index order))."""
        service = _make_service(tmp_path)
        c0, c1, c2 = b"aaaa", b"bbbb", b"cccc"
        total = c0 + c1 + c2
        session = service.create_session(
            "u1", "f.png", "image/png", len(total), 3
        )
        # Upload out of order
        service.save_chunk(session.session_id, "u1", 2, c2)
        service.save_chunk(session.session_id, "u1", 0, c0)
        service.save_chunk(session.session_id, "u1", 1, c1)
        finalized = service.finalize(session.session_id, "u1")
        assert finalized.artifact_checksum == _sha256(total)


# ===========================================================================
# Artifact-level integrity on finalize (corruption detection)
# ===========================================================================

class TestArtifactChecksumCorruptionDetection:
    """finalize() rejects an assembled artifact whose checksum doesn't match."""

    def test_finalize_wrong_declared_checksum_raises(self, tmp_path):
        service = _make_service(tmp_path)
        payload = b"realdata"
        wrong_checksum = _sha256(b"different-data")
        session = service.create_session(
            "u1", "f.png", "image/png", len(payload), 1,
            expected_artifact_checksum=wrong_checksum,
        )
        service.save_chunk(session.session_id, "u1", 0, payload)
        with pytest.raises(UploadSessionError) as exc_info:
            service.finalize(session.session_id, "u1")
        assert exc_info.value.code == "artifact_checksum_mismatch"

    def test_corrupt_artifact_file_is_deleted_on_mismatch(self, tmp_path):
        """A partial/corrupt artifact file must be cleaned up when rejected."""
        service = _make_service(tmp_path)
        payload = b"realdata"
        wrong_checksum = _sha256(b"other")
        session = service.create_session(
            "u1", "f.png", "image/png", len(payload), 1,
            expected_artifact_checksum=wrong_checksum,
        )
        service.save_chunk(session.session_id, "u1", 0, payload)
        with pytest.raises(UploadSessionError):
            service.finalize(session.session_id, "u1")

        # No artifact file should remain on disk
        artifact_files = [
            f for f in os.listdir(service.storage_dir)
            if not os.path.isdir(os.path.join(service.storage_dir, f))
        ]
        assert artifact_files == [], f"Orphaned artifact files found: {artifact_files}"

    def test_session_not_marked_completed_on_checksum_failure(self, tmp_path):
        service = _make_service(tmp_path)
        payload = b"data"
        wrong = _sha256(b"nope")
        session = service.create_session(
            "u1", "f.png", "image/png", 4, 1,
            expected_artifact_checksum=wrong,
        )
        service.save_chunk(session.session_id, "u1", 0, payload)
        with pytest.raises(UploadSessionError):
            service.finalize(session.session_id, "u1")
        assert session.completed is False
        assert session.artifact_id is None

    def test_checksum_mismatch_error_message_contains_hashes(self, tmp_path):
        service = _make_service(tmp_path)
        payload = b"abc"
        wrong = "0" * 64
        session = service.create_session(
            "u1", "f.png", "image/png", 3, 1,
            expected_artifact_checksum=wrong,
        )
        service.save_chunk(session.session_id, "u1", 0, payload)
        with pytest.raises(UploadSessionError) as exc_info:
            service.finalize(session.session_id, "u1")
        assert wrong in exc_info.value.message
        assert _sha256(payload) in exc_info.value.message
