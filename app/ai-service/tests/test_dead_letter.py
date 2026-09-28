"""
Tests for dead-letter capture and replay (Issue #776).

Coverage
--------
* DeadLetterQueue service: add/list/get, dedupe, replay-eligibility checks,
  audit trail, exhaustion, and per-item cooldown rate limiting.
* tasks.py integration: a failed webhook callback and a Celery task that
  exhausts its retry budget both land in the dead-letter queue.
* API: list/get/replay endpoints, including role authorization, replay
  success, replay exhaustion, and cooldown rate limiting (429).
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import metrics
import tasks
import threading
from config import settings
from services.dead_letter import DeadLetterError, DeadLetterQueue, dead_letter_queue


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture(autouse=True)
def clear_dead_letter_queue():
    dead_letter_queue.clear()
    yield
    dead_letter_queue.clear()


@pytest.fixture()
def client():
    import main

    return TestClient(main.app, follow_redirects=False)


def _run_thread_synchronously(monkeypatch):
    """Make ``threading.Thread(...).start()`` run its target inline."""

    class _SyncThread:
        def __init__(self, target=None, daemon=None, **kwargs):
            self._target = target

        def start(self):
            if self._target:
                self._target()

    monkeypatch.setattr(threading, "Thread", _SyncThread)


# ---------------------------------------------------------------------------
# DeadLetterQueue service
# ---------------------------------------------------------------------------


class TestDeadLetterQueueService:
    def test_add_and_get(self):
        queue = DeadLetterQueue(max_attempts=3, cooldown_seconds=0)
        entry = queue.add(
            kind="callback", task_id="t-1", payload={"status": "failed"}, error="boom"
        )

        assert entry.id == "callback:t-1"
        assert entry.status == "pending"
        assert entry.attempts == 0
        assert queue.get(entry.id) is entry

    def test_add_is_idempotent_per_task_and_kind(self):
        queue = DeadLetterQueue(max_attempts=3, cooldown_seconds=0)
        queue.add(
            kind="async_job", task_id="t-1", payload={"a": 1}, error="first failure"
        )
        second = queue.add(
            kind="async_job", task_id="t-1", payload={"a": 2}, error="second failure"
        )

        assert len(queue.list()) == 1
        assert second.error == "second failure"
        assert second.payload == {"a": 2}

    def test_list_filters_by_kind_and_status(self):
        queue = DeadLetterQueue(max_attempts=3, cooldown_seconds=0)
        queue.add(kind="callback", task_id="c-1", payload={}, error="e")
        queue.add(kind="async_job", task_id="j-1", payload={}, error="e")

        assert len(queue.list(kind="callback")) == 1
        assert len(queue.list(kind="async_job")) == 1
        assert len(queue.list(status="pending")) == 2
        assert len(queue.list(status="succeeded")) == 0

    def test_check_replayable_raises_not_found(self):
        queue = DeadLetterQueue(max_attempts=3, cooldown_seconds=0)
        with pytest.raises(DeadLetterError) as exc:
            queue.check_replayable("missing")
        assert str(exc.value) == "not_found"

    def test_replay_success_marks_succeeded(self):
        queue = DeadLetterQueue(max_attempts=3, cooldown_seconds=0)
        entry = queue.add(kind="callback", task_id="t-1", payload={}, error="boom")

        queue.check_replayable(entry.id)
        updated = queue.record_attempt(entry.id, actor="operator-1", success=True)

        assert updated.status == "succeeded"
        assert updated.attempts == 1
        assert updated.audit_log[0].actor == "operator-1"
        assert updated.audit_log[0].outcome == "succeeded"

        # Already-succeeded items can't be replayed again.
        with pytest.raises(DeadLetterError) as exc:
            queue.check_replayable(entry.id)
        assert str(exc.value) == "already_succeeded"

    def test_replay_exhaustion_after_max_attempts(self):
        queue = DeadLetterQueue(max_attempts=2, cooldown_seconds=0)
        entry = queue.add(kind="callback", task_id="t-1", payload={}, error="boom")

        queue.check_replayable(entry.id)
        queue.record_attempt(entry.id, actor="op", success=False, error="still failing")
        assert queue.get(entry.id).status == "pending"

        queue.check_replayable(entry.id)
        updated = queue.record_attempt(
            entry.id, actor="op", success=False, error="still failing"
        )
        assert updated.status == "exhausted"
        assert updated.attempts == 2

        with pytest.raises(DeadLetterError) as exc:
            queue.check_replayable(entry.id)
        assert str(exc.value) == "exhausted"

    def test_cooldown_rate_limits_rapid_replays(self):
        queue = DeadLetterQueue(max_attempts=5, cooldown_seconds=60)
        entry = queue.add(kind="callback", task_id="t-1", payload={}, error="boom")

        queue.check_replayable(entry.id)
        queue.record_attempt(entry.id, actor="op", success=False, error="still failing")

        with pytest.raises(DeadLetterError) as exc:
            queue.check_replayable(entry.id)
        assert str(exc.value) == "rate_limited"


# ---------------------------------------------------------------------------
# tasks.py integration - capture on failure
# ---------------------------------------------------------------------------


class TestDeadLetterCapture:
    def test_webhook_delivery_failure_is_dead_lettered(self, monkeypatch):
        _run_thread_synchronously(monkeypatch)
        monkeypatch.setattr(
            settings, "backend_webhook_url", "http://backend.test/webhook"
        )

        mock_response = MagicMock(status_code=500, text="upstream error")
        with patch("httpx.Client.post", return_value=mock_response):
            tasks.send_webhook_notification(
                "task-webhook-1", "completed", result={"ok": True}
            )

        entry = dead_letter_queue.get("callback:task-webhook-1")
        assert entry is not None
        assert entry.kind == "callback"
        assert entry.status == "pending"
        assert entry.payload["status"] == "completed"
        assert entry.payload["result"] == {"ok": True}

    def test_successful_webhook_delivery_is_not_dead_lettered(self, monkeypatch):
        _run_thread_synchronously(monkeypatch)
        monkeypatch.setattr(
            settings, "backend_webhook_url", "http://backend.test/webhook"
        )

        mock_response = MagicMock(status_code=200, text="ok")
        with patch("httpx.Client.post", return_value=mock_response):
            tasks.send_webhook_notification(
                "task-webhook-2", "completed", result={"ok": True}
            )

        assert dead_letter_queue.get("callback:task-webhook-2") is None

    def test_task_retry_exhaustion_is_dead_lettered(self, monkeypatch):
        monkeypatch.setattr(
            settings, "backend_webhook_url", None
        )  # keep this test focused on the DLQ
        payload = {"type": "model_inference", "data": {}}

        tasks.handle_task_retries_exhausted(
            "task-async-1", payload, "provider unreachable"
        )

        entry = dead_letter_queue.get("async_job:task-async-1")
        assert entry is not None
        assert entry.kind == "async_job"
        assert entry.task_type == "model_inference"
        assert entry.error == "provider unreachable"
        assert entry.payload == payload

        status = tasks.get_task_status("task-async-1")
        assert status["status"] == "failed"


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


class TestDeadLetterAPI:
    def _seed_callback_entry(self, task_id="task-api-1"):
        return dead_letter_queue.add(
            kind="callback",
            task_id=task_id,
            payload={"status": "completed", "result": {"ok": True}, "error": None},
            error="connection refused",
        )

    def test_list_requires_authorized_role(self, client):
        response = client.get("/v1/ai/dead-letter")
        assert response.status_code == 403

    def test_list_returns_items_for_authorized_role(self, client):
        self._seed_callback_entry()

        response = client.get("/v1/ai/dead-letter", headers={"X-User-Role": "operator"})

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert data["items"][0]["kind"] == "callback"

    def test_get_missing_item_returns_404(self, client):
        response = client.get(
            "/v1/ai/dead-letter/callback:does-not-exist",
            headers={"X-User-Role": "admin"},
        )
        assert response.status_code == 404

    def test_replay_requires_authorized_role(self, client):
        entry = self._seed_callback_entry()

        response = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "reviewer"},
        )

        assert response.status_code == 403

    def test_replay_success_updates_item_and_audit_log(self, client, monkeypatch):
        entry = self._seed_callback_entry()
        monkeypatch.setattr(
            tasks, "replay_callback_delivery", lambda task_id, payload: None
        )

        response = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "operator", "X-User-Id": "op-42"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["item"]["status"] == "succeeded"
        assert data["item"]["audit_log"][0]["actor"] == "op-42"
        assert data["item"]["audit_log"][0]["outcome"] == "succeeded"

    def test_replay_exhaustion_returns_409_after_max_attempts(
        self, client, monkeypatch
    ):
        monkeypatch.setattr(dead_letter_queue, "max_attempts", 1)
        monkeypatch.setattr(dead_letter_queue, "cooldown_seconds", 0)

        entry = self._seed_callback_entry()

        def always_fails(task_id, payload):
            raise RuntimeError("still down")

        monkeypatch.setattr(tasks, "replay_callback_delivery", always_fails)

        first = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "operator", "X-User-Id": "op-1"},
        )
        assert first.status_code == 200
        assert first.json()["item"]["status"] == "exhausted"

        second = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "operator", "X-User-Id": "op-1"},
        )
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "exhausted"

    def test_replay_cooldown_returns_429(self, client, monkeypatch):
        monkeypatch.setattr(dead_letter_queue, "max_attempts", 5)
        monkeypatch.setattr(dead_letter_queue, "cooldown_seconds", 60)

        entry = self._seed_callback_entry()

        def always_fails(task_id, payload):
            raise RuntimeError("still down")

        monkeypatch.setattr(tasks, "replay_callback_delivery", always_fails)

        first = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "operator", "X-User-Id": "op-1"},
        )
        assert first.status_code == 200

        second = client.post(
            f"/v1/ai/dead-letter/{entry.id}/replay",
            headers={"X-User-Role": "operator", "X-User-Id": "op-1"},
        )
        assert second.status_code == 429
        assert second.json()["error"]["code"] == "rate_limited"
        assert "Retry-After" in second.headers
