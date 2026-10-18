"""
Tests for scheduled purge of abandoned upload sessions and expired artifacts.
"""

import os
import time

from services.upload_sessions import UploadSessionService

ALLOWED_TYPES = {"image/png", "application/pdf"}


def _make_service(tmp_path, ttl_seconds=3600, max_bytes=1024):
    return UploadSessionService(
        storage_dir=str(tmp_path / "uploads"),
        allowed_content_types=ALLOWED_TYPES,
        max_upload_bytes=max_bytes,
        session_ttl_seconds=ttl_seconds,
    )


def test_purge_removes_abandoned_expired_sessions(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    session.expires_at = time.time() - 1

    result = service.purge_abandoned_sessions()

    assert result.items_purged == 1
    assert result.bytes_reclaimed == 2
    assert session.session_id not in service._sessions
    assert not os.path.isdir(service._session_dir(session.session_id))


def test_purge_never_touches_in_progress_sessions(tmp_path):
    service = _make_service(tmp_path, ttl_seconds=3600)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")

    result = service.purge_abandoned_sessions()

    assert result.items_purged == 0
    assert session.session_id in service._sessions
    assert os.path.isdir(service._session_dir(session.session_id))


def test_purge_never_touches_completed_sessions_even_if_ttl_elapsed(tmp_path):
    service = _make_service(tmp_path, ttl_seconds=3600)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    service.finalize(session.session_id, "user-1")

    session.expires_at = time.time() - 1000  # simulate an old finalized session

    result = service.purge_abandoned_sessions()

    assert result.items_purged == 0
    assert session.session_id in service._sessions


def test_dry_run_reports_without_deleting(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    session.expires_at = time.time() - 1

    result = service.purge_abandoned_sessions(dry_run=True)

    assert result.items_purged == 1
    assert result.bytes_reclaimed == 2
    assert session.session_id in service._sessions
    assert os.path.isdir(service._session_dir(session.session_id))


def test_purge_expired_artifacts_removes_old_files(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    finalized = service.finalize(session.session_id, "user-1")

    artifact_path = os.path.join(service.storage_dir, f"{finalized.artifact_id}_e.png")
    old_time = time.time() - 1000
    os.utime(artifact_path, (old_time, old_time))

    result = service.purge_expired_artifacts(retention_seconds=100)

    assert result.items_purged == 1
    assert result.bytes_reclaimed == 2
    assert not os.path.exists(artifact_path)


def test_purge_expired_artifacts_skips_fresh_files(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")
    finalized = service.finalize(session.session_id, "user-1")

    artifact_path = os.path.join(service.storage_dir, f"{finalized.artifact_id}_e.png")

    result = service.purge_expired_artifacts(retention_seconds=100)

    assert result.items_purged == 0
    assert os.path.exists(artifact_path)


def test_purge_expired_artifacts_ignores_sessions_directory(tmp_path):
    service = _make_service(tmp_path)
    session = service.create_session("user-1", "e.png", "image/png", 2, 1)
    service.save_chunk(session.session_id, "user-1", 0, b"aa")

    session_dir = service._session_dir(session.session_id)
    old_time = time.time() - 1000
    os.utime(session_dir, (old_time, old_time))

    result = service.purge_expired_artifacts(retention_seconds=100)

    assert result.items_purged == 0
    assert os.path.isdir(session_dir)


def test_purge_expired_artifacts_respects_batch_size(tmp_path):
    service = _make_service(tmp_path)
    old_time = time.time() - 1000
    for i in range(5):
        path = os.path.join(service.storage_dir, f"artifact-{i}.bin")
        with open(path, "wb") as handle:
            handle.write(b"x")
        os.utime(path, (old_time, old_time))

    result = service.purge_expired_artifacts(retention_seconds=100, batch_size=2)

    assert result.items_purged == 2
    remaining = [name for name in os.listdir(service.storage_dir) if name != "sessions"]
    assert len(remaining) == 3
