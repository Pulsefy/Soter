import base64
import io
from unittest.mock import MagicMock, patch

import metrics
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import tasks
from config import settings
from schemas.callback import AiCallbackPayload, CallbackStatus


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
        data={"document_type": "passport"},
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
    assert captured["payload"]["document_type"] == "passport"


def test_queued_ocr_job_rejects_invalid_image(client, monkeypatch):
    create_task = MagicMock()
    monkeypatch.setattr(tasks, "create_task", create_task)

    response = client.post(
        "/v1/ai/ocr/jobs",
        files={"image": ("document.png", b"not-a-real-image", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"
    create_task.assert_not_called()


def test_task_status_endpoint_returns_local_job_status(client):
    tasks.update_task_status(
        "ocr-task-complete",
        "completed",
        result={
            "type": "ocr",
            "result": {
                "success": True,
                "confidence": 0.55,
                "confidence_banding": "LOW",
                "requires_review": True,
            },
            "requires_review": True,
            "confidence": 0.55,
            "confidence_banding": "LOW",
        },
    )

    response = client.get("/v1/ai/jobs/ocr-task-complete")

    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == "ocr-task-complete"
    assert data["status"] == "completed"
    assert data["result"]["type"] == "ocr"
    assert data["result"]["requires_review"] is True
    assert data["result"]["confidence"] == 0.55
    assert data["result"]["confidence_banding"] == "LOW"


def test_batch_ocr_returns_document_statuses_for_mixed_inputs(client, monkeypatch):
    created_tasks = []

    def fake_create_task(task_type, payload):
        created_tasks.append((task_type, payload))
        return f"ocr-task-{len(created_tasks)}"

    monkeypatch.setattr(tasks, "create_task", fake_create_task)

    response = client.post(
        "/v1/ai/ocr/batch",
        data={"document_type": "id_card"},
        files=[
            ("files", "doc-a.png", _png_bytes(), "image/png"),
            ("files", "doc-b.png", b"not-a-real-image", "image/png"),
            ("files", "doc-c.png", _png_bytes(), "image/png"),
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
    assert created_tasks[0][1]["document_type"] == "id_card"


def test_process_ocr_flags_low_confidence_in_task_result(monkeypatch):
    from services.ocr import OCRResult, FieldMatch

    fake_ocr_result = OCRResult(
        fields={"name": FieldMatch(value="Blurry", confidence=0.4)},
        raw_text="Name: Blurry",
        processing_time_ms=50,
        confidence=0.4,
        confidence_banding="LOW",
        requires_review=True,
        review_reasons=["Confidence 0.4000 is below threshold 0.7500"],
    )

    with patch("services.ocr_job.ocr_service.process_image", return_value=fake_ocr_result):
        payload = {
            "image_base64": base64.b64encode(_png_bytes()).decode("ascii"),
            "document_type": "id_card",
        }
        task_output = tasks._process_ocr(payload)

        assert task_output["type"] == "ocr"
        assert task_output["status"] == "success"
        assert task_output["requires_review"] is True
        assert task_output["confidence"] == 0.4
        assert task_output["confidence_banding"] == "LOW"
        assert task_output["result"]["requires_review"] is True


def test_callback_payload_includes_review_flag():
    result_with_review = {
        "type": "ocr",
        "requires_review": True,
        "confidence": 0.52,
        "confidence_banding": "LOW",
        "result": {"success": True},
    }

    callback = AiCallbackPayload.build(
        task_id="test-task-123",
        status=CallbackStatus.COMPLETED,
        task_type="ocr",
        result=result_with_review,
    )

    assert callback.result["requires_review"] is True
    assert callback.result["confidence"] == 0.52
    assert callback.result["confidence_banding"] == "LOW"
    dumped = callback.model_dump(by_alias=True)
    assert dumped["result"]["requires_review"] is True


def test_retry_policy_is_defined_on_heavy_task():
    task = tasks.get_process_heavy_inference_task()

    assert task.max_retries == settings.task_max_retries
    assert task.default_retry_delay == settings.task_retry_delay_seconds
    assert tasks.get_celery_app().conf.task_acks_late is True
    assert tasks.get_celery_app().conf.task_reject_on_worker_lost is True
