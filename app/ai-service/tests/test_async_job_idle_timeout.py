"""Idle timeout cleanup for async jobs (issue #1208).

A job that is queued but never receives a worker (e.g. the worker pool is
exhausted) must be marked ``timed_out`` after a configurable idle window
instead of sitting ``pending`` forever, must be reported to callers the
same way cancelled/expired jobs are, and must increment its own metric
without touching completion/cancellation counters. Jobs that are actively
processing - however slow - are never idle-timed-out.
"""

import io
import time

import metrics
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import tasks
from config import settings


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    from unittest.mock import patch

    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture(autouse=True)
def reset_rate_limits():
    from api.v1.ocr import limiter as ocr_limiter

    ocr_limiter.reset()
    yield


@pytest.fixture()
def client():
    return TestClient(main.app, follow_redirects=False)


@pytest.fixture()
def idle_window(monkeypatch):
    monkeypatch.setattr(settings, "async_job_idle_timeout_seconds", 60.0)
    return 60.0


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _seed_queued_task(task_id: str, *, task_type: str = "ocr", idle_for: float = 0.0):
    """Create a local ``pending`` record as if the job were still queued."""
    tasks.update_task_status(task_id, "pending", task_type=task_type)
    if idle_for:
        tasks.task_results[task_id]["updated_at"] = time.time() - idle_for
    return task_id


def _install_async_result(monkeypatch, state: str = "PENDING"):
    """Replace celery's AsyncResult with a stub reporting ``state``."""
    revoked = []

    class StubAsyncResult:
        def __init__(self, task_id, app=None):
            self.task_id = task_id
            self.state = state

        def ready(self):
            return self.state in ("SUCCESS", "FAILURE")

        def started(self):
            return self.state == "STARTED"

        def successful(self):
            return self.state == "SUCCESS"

        def failed(self):
            return self.state == "FAILURE"

        @property
        def result(self):
            return None

        @property
        def info(self):
            return None

        def revoke(self, terminate=False):
            revoked.append((self.task_id, terminate))

    monkeypatch.setattr(tasks, "AsyncResult", StubAsyncResult)
    return revoked


def _count(counter, task_type: str) -> float:
    return counter.labels(task_type=task_type)._value.get()


# ---------------------------------------------------------------------------
# Core transition: idle vs active jobs
# ---------------------------------------------------------------------------


def test_queued_job_past_idle_window_is_marked_timed_out(monkeypatch, idle_window):
    _seed_queued_task("ocr-idle-1", task_type="ocr", idle_for=idle_window + 5)
    revoked = _install_async_result(monkeypatch, state="PENDING")

    cancelled_before = _count(metrics.JOB_CANCELLED_TOTAL, "ocr")
    expired_before = _count(metrics.JOB_EXPIRED_TOTAL, "ocr")
    timed_out_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr")

    status = tasks.get_task_status("ocr-idle-1")

    assert status["status"] == "timed_out"
    assert "worker" in status["error"]
    # The queued Celery message is revoked so no worker can pick it up late.
    assert ("ocr-idle-1", True) in revoked
    # Idle timeouts are tracked separately from completion/cancellation/expiry.
    assert _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr") == timed_out_before + 1
    assert _count(metrics.JOB_CANCELLED_TOTAL, "ocr") == cancelled_before
    assert _count(metrics.JOB_EXPIRED_TOTAL, "ocr") == expired_before


def test_queued_job_within_idle_window_stays_pending(monkeypatch, idle_window):
    _seed_queued_task("ocr-idle-2", task_type="ocr", idle_for=idle_window - 10)
    revoked = _install_async_result(monkeypatch, state="PENDING")
    timed_out_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr")

    status = tasks.get_task_status("ocr-idle-2")

    assert status["status"] == "pending"
    assert revoked == []
    assert _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr") == timed_out_before


def test_started_job_past_idle_window_is_not_timed_out(monkeypatch, idle_window):
    """A worker holds the job (STARTED) even though the local record still
    says pending - the API process never observes the worker's update. Such
    a job is actively processing and must never be idle-timed-out, however
    long it runs."""
    _seed_queued_task("ocr-idle-3", task_type="ocr", idle_for=idle_window * 10)
    revoked = _install_async_result(monkeypatch, state="STARTED")
    timed_out_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr")

    status = tasks.get_task_status("ocr-idle-3")

    assert status["status"] == "processing"
    assert tasks.task_results["ocr-idle-3"]["status"] == "pending"
    assert revoked == []
    assert _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr") == timed_out_before


def test_job_between_retries_past_idle_window_is_not_timed_out(
    monkeypatch, idle_window
):
    """Celery reports RETRY while a started job waits out its retry delay;
    that is not an idle queue wait."""
    _seed_queued_task("ocr-idle-4", task_type="ocr", idle_for=idle_window * 10)
    _install_async_result(monkeypatch, state="RETRY")
    timed_out_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr")

    status = tasks.get_task_status("ocr-idle-4")

    assert status["status"] == "pending"
    assert tasks.task_results["ocr-idle-4"]["status"] == "pending"
    assert _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr") == timed_out_before


def test_timed_out_is_terminal_and_metric_increments_once(monkeypatch, idle_window):
    _seed_queued_task("ocr-idle-5", task_type="ocr", idle_for=idle_window + 5)
    _install_async_result(monkeypatch, state="PENDING")
    timed_out_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr")

    first = tasks.get_task_status("ocr-idle-5")
    second = tasks.get_task_status("ocr-idle-5")

    assert first["status"] == "timed_out"
    assert second["status"] == "timed_out"
    assert _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, "ocr") == timed_out_before + 1


def test_client_supplied_task_type_is_bounded_for_idle_timeout_metric(
    monkeypatch, idle_window
):
    _seed_queued_task("ocr-idle-6", task_type="<weird>&type", idle_for=idle_window + 5)
    _install_async_result(monkeypatch, state="PENDING")
    other_before = _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, metrics.OTHER_TASK_TYPE_LABEL)

    status = tasks.get_task_status("ocr-idle-6")

    assert status["status"] == "timed_out"
    assert (
        _count(metrics.JOB_IDLE_TIMEOUT_TOTAL, metrics.OTHER_TASK_TYPE_LABEL)
        == other_before + 1
    )


# ---------------------------------------------------------------------------
# Caller-facing reporting: job status endpoint and batch OCR, matching how
# cancelled/expired jobs are already reported
# ---------------------------------------------------------------------------


def test_job_status_endpoint_reports_timed_out_with_reason(
    client, monkeypatch, idle_window
):
    _seed_queued_task("ocr-idle-api-1", task_type="ocr", idle_for=idle_window + 5)
    _install_async_result(monkeypatch, state="PENDING")

    response = client.get("/v1/ai/jobs/ocr-idle-api-1")

    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == "ocr-idle-api-1"
    assert data["status"] == "timed_out"
    assert "worker" in data["error"]


def test_batch_ocr_reports_timed_out_like_cancelled(client, monkeypatch, idle_window):
    _seed_queued_task("ocr-idle-batch-1", task_type="ocr", idle_for=idle_window + 5)
    _install_async_result(monkeypatch, state="PENDING")
    monkeypatch.setattr(tasks, "create_task", lambda *a, **k: "ocr-idle-batch-1")

    submit = client.post(
        "/v1/ai/ocr/batch",
        files=[("files", ("doc.png", _png_bytes(), "image/png"))],
    )
    assert submit.status_code == 202

    data = client.get(submit.json()["status_url"]).json()
    doc = data["documents"][0]

    # Same terminal treatment as a cancelled/expired job: failed with a
    # job_* reason code, and still individually retryable.
    assert doc["status"] == "failed"
    assert doc["error"] == {
        "code": "job_timed_out",
        "message": "OCR job timed out",
    }
    assert doc["retry_url"] is not None
    assert data["status"] == "failed"
    assert data["summary"]["failed"] == 1
