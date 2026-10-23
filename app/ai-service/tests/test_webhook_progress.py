import json
import threading
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

import main
import tasks
from config import settings
from services.dead_letter import dead_letter_queue


@pytest.fixture(autouse=True)
def clear_dead_letter_queue():
    dead_letter_queue.clear()
    yield
    dead_letter_queue.clear()


def _run_thread_synchronously(monkeypatch):
    class _SyncThread:
        def __init__(self, target=None, daemon=None, **kwargs):
            self._target = target

        def start(self):
            if self._target:
                self._target()

    monkeypatch.setattr(threading, "Thread", _SyncThread)


def test_inference_request_registers_webhook_url():
    client = TestClient(main.app)

    with patch(
        "api.v1.inference.tasks.create_task", return_value="task-webhook"
    ) as create_task:
        response = client.post(
            "/v1/ai/inference",
            json={
                "type": "inference",
                "data": {"value": "input"},
                "webhook_url": "https://client.example.com/task-events",
            },
        )

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-webhook"
    assert create_task.call_args.kwargs["payload"]["webhook_url"] == (
        "https://client.example.com/task-events"
    )


def test_registered_webhook_receives_processing_and_completion(monkeypatch):
    notifications = []
    monkeypatch.setattr(
        tasks,
        "send_webhook_notification",
        lambda *args, **kwargs: notifications.append((args, kwargs)),
    )

    with patch("tasks._process_default_inference", return_value={"status": "success"}):
        tasks.process_heavy_inference_impl(
            None,
            "task-progress",
            {
                "type": "inference",
                "webhook_url": "https://client.example.com/task-events",
            },
        )

    assert [call[0][1] for call in notifications] == ["processing", "completed"]
    assert all(
        call[1]["webhook_url"] == "https://client.example.com/task-events"
        for call in notifications
    )
    assert all(call[1]["task_type"] == "inference" for call in notifications)


def test_failed_progress_delivery_is_dead_lettered_and_replay_keeps_destination(
    monkeypatch,
):
    _run_thread_synchronously(monkeypatch)
    monkeypatch.setattr(settings, "backend_webhook_url", None)

    mock_response = MagicMock(status_code=503, text="temporarily unavailable")
    with patch("httpx.Client.post", return_value=mock_response):
        tasks.send_webhook_notification(
            "task-progress-failed",
            "processing",
            webhook_url="https://client.example.com/task-events",
            task_type="inference",
        )

    entry = dead_letter_queue.get("callback:task-progress-failed:processing")
    assert entry is not None
    assert entry.payload["status"] == "processing"
    assert entry.payload["webhook_url"] == "https://client.example.com/task-events"

    with patch("tasks.deliver_webhook") as deliver:
        tasks.replay_callback_delivery(entry.task_id, entry.payload)

    body = json.loads(deliver.call_args.args[0])
    assert body["status"] == "processing"
    assert body["taskType"] == "inference"
    assert deliver.call_args.kwargs["webhook_url"] == (
        "https://client.example.com/task-events"
    )


def test_progress_and_completion_failures_have_separate_dead_letters(monkeypatch):
    _run_thread_synchronously(monkeypatch)
    monkeypatch.setattr(settings, "backend_webhook_url", None)
    failed_response = MagicMock(status_code=503, text="temporarily unavailable")

    with patch("httpx.Client.post", return_value=failed_response):
        tasks.send_webhook_notification(
            "task-two-failures",
            "processing",
            webhook_url="https://client.example.com/task-events",
        )
        tasks.send_webhook_notification(
            "task-two-failures",
            "completed",
            result={"ok": True},
            webhook_url="https://client.example.com/task-events",
        )

    progress_entry = dead_letter_queue.get("callback:task-two-failures:processing")
    completion_entry = dead_letter_queue.get("callback:task-two-failures")
    assert progress_entry is not None
    assert completion_entry is not None
    assert progress_entry.payload["status"] == "processing"
    assert completion_entry.payload["status"] == "completed"
