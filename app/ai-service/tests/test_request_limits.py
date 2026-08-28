from fastapi.testclient import TestClient

import main
import metrics
from config import settings
from request_limits import clamp_request_timeout


def test_oversized_v1_body_returns_413_and_records_metric(monkeypatch):
    monkeypatch.setattr(settings, "max_request_body_bytes", 16)
    client = TestClient(main.app, raise_server_exceptions=False)

    before = metrics.REQUEST_REJECTIONS_TOTAL.labels(
        endpoint="/v1/ai/anonymize", reason="request_body_too_large"
    )._value.get()
    response = client.post(
        "/v1/ai/anonymize",
        content=b"x" * 17,
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_BODY_TOO_LARGE"
    after = metrics.REQUEST_REJECTIONS_TOTAL.labels(
        endpoint="/v1/ai/anonymize", reason="request_body_too_large"
    )._value.get()
    assert after == before + 1


def test_timeout_is_clamped_and_records_metric(monkeypatch):
    monkeypatch.setattr(settings, "max_request_timeout_seconds", 30)

    before = metrics.REQUEST_REJECTIONS_TOTAL.labels(
        endpoint="/v1/ai/humanitarian/verify", reason="timeout_clamped"
    )._value.get()
    timeout = clamp_request_timeout(90, "/v1/ai/humanitarian/verify")

    assert timeout == 30
    after = metrics.REQUEST_REJECTIONS_TOTAL.labels(
        endpoint="/v1/ai/humanitarian/verify", reason="timeout_clamped"
    )._value.get()
    assert after == before + 1


def test_timeout_below_ceiling_is_unchanged(monkeypatch):
    monkeypatch.setattr(settings, "max_request_timeout_seconds", 30)

    assert clamp_request_timeout(15, "/v1/ai/humanitarian/verify") == 15
