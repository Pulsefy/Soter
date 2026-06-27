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


def test_retry_policy_is_defined_on_heavy_task():
    task = tasks.get_process_heavy_inference_task()

    assert task.max_retries == settings.task_max_retries
    assert task.default_retry_delay == settings.task_retry_delay_seconds
    assert tasks.get_celery_app().conf.task_acks_late is True
    assert tasks.get_celery_app().conf.task_reject_on_worker_lost is True
