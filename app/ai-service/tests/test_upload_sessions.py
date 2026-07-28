"""
Tests for the resumable evidence upload session service.
"""

import os

import pytest

from services.upload_sessions import UploadSessionError, UploadSessionService

ALLOWED_TYPES = {"image/png", "application/pdf"}


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