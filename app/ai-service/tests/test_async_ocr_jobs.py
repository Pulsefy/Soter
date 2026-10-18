import io
from unittest.mock import MagicMock, patch

import metrics
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import tasks
from config import settings


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture()
def client():
    return TestClient(main.app, follow_redirects=False)


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_queue_ocr_job_returns_accepted_with_status_url(client, monkeypatch):
    captured = {}

    def fake_create_task(task_type, payload):
        captured["task_type"] = task_type
        captured["payload"] = payload
        return "ocr-task-123"

    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/jobs",
        files={"image": ("document.png", _png_bytes(), "image/png")},
    )

    assert response.status_code == 202
    data = response.json()
    assert data["success"] is True
    assert data["task_id"] == "ocr-task-123"
    assert data["status"] == "pending"
    assert data["status_url"] == "/v1/ai/jobs/ocr-task-123"
    assert captured["task_type"] == "ocr"
    assert captured["payload"]["image_base64"]
    assert captured["payload"]["content_type"] == "image/png"


def test_queued_ocr_job_rejects_invalid_image(client, monkeypatch):
    create_task = MagicMock()
    monkeypatch.setattr(tasks, "create_task", create_task)

    response = client.post(
        "/v1/ai/ocr/jobs",
        files={"image": ("document.png", b"not-a-real-image", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"].startswith("{'code': 'invalid_image'")
    create_task.assert_not_called()


def test_task_status_endpoint_returns_local_job_status(client):
    tasks.update_task_status(
        "ocr-task-complete",
        "completed",
        result={"type": "ocr", "result": {"success": True}},
    )

    response = client.get("/v1/ai/jobs/ocr-task-complete")

    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == "ocr-task-complete"
    assert data["status"] == "completed"
    assert data["result"]["type"] == "ocr"


def test_batch_ocr_returns_document_statuses_for_mixed_inputs(client, monkeypatch):
    created_tasks = []

    def fake_create_task(task_type, payload):
        created_tasks.append((task_type, payload))
        return f"ocr-task-{len(created_tasks)}"

    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", _png_bytes(), "image/png")),
            ("files", ("doc-b.png", b"not-a-real-image", "image/png")),
            ("files", ("doc-c.png", _png_bytes(), "image/png")),
        ],
    )

    assert response.status_code == 202
    data = response.json()
    assert data["success"] is True
    assert len(data["documents"]) == 3
    assert data["documents"][0]["status"] == "pending"
    assert data["documents"][0]["task_id"] == "ocr-task-1"
    assert data["documents"][1]["status"] == "failed"
    assert data["documents"][1]["error"]["code"] == "invalid_image"
    assert data["documents"][2]["status"] == "pending"
    assert data["documents"][2]["task_id"] == "ocr-task-2"
    assert len(created_tasks) == 2


def test_retry_policy_is_defined_on_heavy_task():
    task = tasks.get_process_heavy_inference_task()

    assert task.max_retries == settings.task_max_retries
    assert task.default_retry_delay == settings.task_retry_delay_seconds
    assert tasks.get_celery_app().conf.task_acks_late is True
    assert tasks.get_celery_app().conf.task_reject_on_worker_lost is True


# ---------------------------------------------------------------------------
# Batch OCR: per-document outcomes, partial failure, individual retry
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Clear the slowapi counters shared by this module's endpoints.

    The OCR endpoints are rate limited (10/minute by default); without a
    per-test reset, requests made by earlier tests in this file would trip
    the limit for later ones.
    """
    from api.v1.ocr import limiter as ocr_limiter

    ocr_limiter.reset()
    yield


def _queueing_stub():
    """Replace tasks.create_task with a stub that records queued payloads.

    Returns the call list and the stub so tests can assert exactly which
    documents were (re)queued.
    """
    created_tasks = []

    def fake_create_task(task_type, payload):
        created_tasks.append((task_type, payload))
        return f"ocr-task-{len(created_tasks)}"

    return created_tasks, fake_create_task


def test_batch_submission_reports_batch_id_and_document_outcomes(client, monkeypatch):
    _created_tasks, fake_create_task = _queueing_stub()
    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", _png_bytes(), "image/png")),
            ("files", ("doc-b.png", b"not-a-real-image", "image/png")),
        ],
    )

    assert response.status_code == 202
    data = response.json()
    assert data["batch_id"]
    assert data["status_url"] == f"/v1/ai/ocr/batch/{data['batch_id']}"
    # One document queued, one rejected: the batch is not finished yet.
    assert data["status"] == "processing"
    assert data["success"] is True
    assert data["summary"] == {
        "total": 2,
        "pending": 1,
        "processing": 0,
        "succeeded": 0,
        "failed": 1,
    }

    pending_doc, failed_doc = data["documents"]
    assert pending_doc["document_id"]
    assert pending_doc["status"] == "pending"
    assert pending_doc["status_url"] == "/v1/ai/jobs/ocr-task-1"
    assert pending_doc["retry_url"] is None
    assert pending_doc["error"] is None

    assert failed_doc["document_id"] != pending_doc["document_id"]
    assert failed_doc["status"] == "failed"
    assert failed_doc["error"]["code"] == "invalid_image"
    # The failed document advertises how to retry it on its own.
    assert failed_doc["retry_url"] == (
        f"/v1/ai/ocr/batch/{data['batch_id']}/documents/"
        f"{failed_doc['document_id']}/retry"
    )


def test_batch_status_separates_mixed_outcomes_and_partial_failure(client, monkeypatch):
    _created_tasks, fake_create_task = _queueing_stub()
    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", _png_bytes(), "image/png")),
            ("files", ("doc-b.png", b"not-a-real-image", "image/png")),
            ("files", ("doc-c.png", _png_bytes(), "image/png")),
        ],
    )
    assert response.status_code == 202
    batch_id = response.json()["batch_id"]

    # doc-a's job finished, doc-c's job is running, doc-b never got a job.
    task_states = {
        "ocr-task-1": {"status": "completed", "error": None},
        "ocr-task-2": {"status": "processing", "error": None},
    }
    monkeypatch.setattr(
        tasks,
        "get_task_status",
        lambda task_id: task_states.get(task_id, {"status": "pending"}),
    )

    data = client.get(f"/v1/ai/ocr/batch/{batch_id}").json()
    doc_a, doc_b, doc_c = data["documents"]

    # Per-document breakdown: succeeded, failed with a reason, and one
    # still processing.
    assert doc_a["status"] == "succeeded"
    assert doc_a["error"] is None
    assert doc_b["status"] == "failed"
    assert doc_b["error"]["code"] == "invalid_image"
    assert doc_c["status"] == "processing"
    assert data["summary"] == {
        "total": 3,
        "pending": 0,
        "processing": 1,
        "succeeded": 1,
        "failed": 1,
    }
    # Work is still outstanding, so no terminal batch status yet.
    assert data["status"] == "processing"

    # Once the last job finishes the batch is *partially* failed - not
    # fully succeeded, not fully failed.
    task_states["ocr-task-2"] = {"status": "completed", "error": None}
    data = client.get(f"/v1/ai/ocr/batch/{batch_id}").json()
    assert data["status"] == "partially_failed"
    assert data["summary"]["succeeded"] == 2
    assert data["summary"]["failed"] == 1


def test_batch_status_is_succeeded_when_every_document_completes(client, monkeypatch):
    _created_tasks, fake_create_task = _queueing_stub()
    monkeypatch.setattr(tasks, "create_task", fake_create_task)
    monkeypatch.setattr(
        tasks,
        "get_task_status",
        lambda task_id: {"status": "completed", "error": None},
    )

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", _png_bytes(), "image/png")),
            ("files", ("doc-b.png", _png_bytes(), "image/png")),
        ],
    )
    assert response.status_code == 202

    data = client.get(response.json()["status_url"]).json()
    assert data["status"] == "succeeded"
    assert data["summary"]["succeeded"] == 2
    assert data["summary"]["failed"] == 0
    assert all(doc["status"] == "succeeded" for doc in data["documents"])


def test_batch_status_is_failed_when_every_document_fails(client, monkeypatch):
    create_task = MagicMock()
    monkeypatch.setattr(tasks, "create_task", create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", b"not-a-real-image", "image/png")),
            ("files", ("doc-b.png", b"also-not-an-image", "image/png")),
        ],
    )
    assert response.status_code == 202
    data = response.json()
    # Fully failed is reported as such at submission time, with success off.
    assert data["status"] == "failed"
    assert data["success"] is False
    create_task.assert_not_called()

    polled = client.get(data["status_url"]).json()
    assert polled["status"] == "failed"
    assert polled["summary"]["failed"] == 2
    for doc in polled["documents"]:
        assert doc["status"] == "failed"
        assert doc["error"]["code"] == "invalid_image"
        assert doc["retry_url"] is not None


def test_retry_failed_document_requeues_only_that_document(client, monkeypatch):
    created_tasks = []

    def flaky_create_task(task_type, payload):
        created_tasks.append((task_type, payload))
        if len(created_tasks) == 2:
            # The second document's queueing blows up (e.g. broker hiccup).
            raise RuntimeError("broker unavailable")
        return f"ocr-task-{len(created_tasks)}"

    monkeypatch.setattr(tasks, "create_task", flaky_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[
            ("files", ("doc-a.png", _png_bytes(), "image/png")),
            ("files", ("doc-b.png", _png_bytes(), "image/png")),
        ],
    )
    assert response.status_code == 202
    data = response.json()
    doc_a, doc_b = data["documents"]
    assert doc_a["status"] == "pending"
    assert doc_b["status"] == "failed"
    assert doc_b["error"] == {
        "code": "processing_error",
        "message": "broker unavailable",
    }

    retry_response = client.post(doc_b["retry_url"])
    assert retry_response.status_code == 202
    new_a, new_b = retry_response.json()["documents"]

    # Only the failed document was requeued...
    assert new_b["status"] == "pending"
    assert new_b["task_id"] == "ocr-task-3"
    assert new_b["error"] is None
    assert new_b["retry_url"] is None
    # ...its sibling keeps its original job, untouched.
    assert new_a["task_id"] == doc_a["task_id"]
    assert new_a["status"] == "pending"
    assert len(created_tasks) == 3


def test_retry_rejects_documents_that_are_not_failed(client, monkeypatch):
    _created_tasks, fake_create_task = _queueing_stub()
    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[("files", ("doc-a.png", _png_bytes(), "image/png"))],
    )
    assert response.status_code == 202
    data = response.json()
    batch_id = data["batch_id"]
    document_id = data["documents"][0]["document_id"]

    # A still-pending document is not retryable.
    conflict = client.post(f"/v1/ai/ocr/batch/{batch_id}/documents/{document_id}/retry")
    assert conflict.status_code == 409
    assert "document_not_failed" in conflict.json()["error"]["message"]

    # Neither is a document from a batch that does not exist.
    missing = client.post(
        f"/v1/ai/ocr/batch/no-such-batch/documents/{document_id}/retry"
    )
    assert missing.status_code == 404
    assert "batch_not_found" in missing.json()["error"]["message"]


def test_retry_invalid_document_stays_failed_with_its_reason(client, monkeypatch):
    create_task = MagicMock()
    monkeypatch.setattr(tasks, "create_task", create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        files=[("files", ("doc-a.png", b"not-a-real-image", "image/png"))],
    )
    assert response.status_code == 202
    data = response.json()
    doc = data["documents"][0]

    # Re-queuing is attempted, revalidation rejects it again, and the
    # document keeps reporting the reason it failed.
    retry_response = client.post(doc["retry_url"])
    assert retry_response.status_code == 400
    assert "invalid_image" in retry_response.json()["error"]["message"]
    create_task.assert_not_called()

    polled = client.get(data["status_url"]).json()
    assert polled["status"] == "failed"
    assert polled["documents"][0]["status"] == "failed"
    assert polled["documents"][0]["error"]["code"] == "invalid_image"
    assert polled["documents"][0]["retry_url"] is not None


def test_batch_status_unknown_batch_returns_404(client):
    response = client.get("/v1/ai/ocr/batch/no-such-batch")

    assert response.status_code == 404
    assert "batch_not_found" in response.json()["error"]["message"]
