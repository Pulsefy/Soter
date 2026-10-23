import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.humanitarian import router
from config import settings
from services.verification_cooldown import verification_cooldown


@pytest.fixture
def verification_client(monkeypatch):
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    app.state.artifact_access_control = Mock()
    service = Mock()
    service.get_prompt_version.return_value = "v1"
    service.get_model_version.return_value = "test:fixture"
    service.verify_claim.side_effect = [
        {
            "provider": "test",
            "model": "fixture",
            "verification": {
                "verdict": "credible",
                "confidence": 0.9,
                "summary": "first result",
            },
        },
        {
            "provider": "test",
            "model": "fixture",
            "verification": {
                "verdict": "inconclusive",
                "confidence": 0.2,
                "summary": "new result",
            },
        },
    ]
    app.state.humanitarian_verification_service = service
    app.state.cache = Mock(enabled=False)
    cache_app = SimpleNamespace(state=SimpleNamespace(cache=Mock(enabled=False)))
    monkeypatch.setitem(sys.modules, "main", SimpleNamespace(app=cache_app))
    verification_cooldown.reset()

    yield TestClient(app), service

    verification_cooldown.reset()


def _payload(context_factors=None):
    return {
        "aid_claim": "Relief teams delivered supplies to registered households.",
        "context_factors": context_factors or {},
        "anchor_metadata": {"claim_id": "claim-cooldown-test"},
    }


def test_repeat_verification_inside_cooldown_returns_prior_result(
    verification_client, monkeypatch
):
    client, service = verification_client
    monkeypatch.setattr(settings, "verification_cooldown_seconds", 60)
    now = [1000.0]
    monkeypatch.setattr(verification_cooldown, "_clock", lambda: now[0])
    headers = {"X-Org-Id": "org-cooldown-test"}

    first = client.post(
        "/v1/ai/humanitarian/verify",
        headers=headers,
        json=_payload({"weather": "stable"}),
    )
    now[0] += 5
    repeated = client.post(
        "/v1/ai/humanitarian/verify",
        headers=headers,
        json=_payload({"weather": "flooding"}),
    )

    assert first.status_code == repeated.status_code == 200
    assert first.json()["result"] == repeated.json()["result"]
    assert repeated.headers["X-Verification-Cooldown"] == "true"
    assert "X-Verification-Cooldown" not in first.headers
    service.verify_claim.assert_called_once()


def test_verification_can_run_again_after_cooldown_expires(
    verification_client, monkeypatch
):
    client, service = verification_client
    monkeypatch.setattr(settings, "verification_cooldown_seconds", 60)
    now = [2000.0]
    monkeypatch.setattr(verification_cooldown, "_clock", lambda: now[0])
    headers = {"X-Org-Id": "org-cooldown-test"}

    first = client.post("/v1/ai/humanitarian/verify", headers=headers, json=_payload())
    now[0] += 61
    after_cooldown = client.post(
        "/v1/ai/humanitarian/verify", headers=headers, json=_payload()
    )

    assert first.status_code == after_cooldown.status_code == 200
    assert after_cooldown.json()["result"]["verification"]["summary"] == "new result"
    assert "X-Verification-Cooldown" not in after_cooldown.headers
    assert service.verify_claim.call_count == 2


def test_cooldown_is_scoped_to_organization(verification_client, monkeypatch):
    client, service = verification_client
    monkeypatch.setattr(settings, "verification_cooldown_seconds", 60)
    now = [3000.0]
    monkeypatch.setattr(verification_cooldown, "_clock", lambda: now[0])

    first = client.post(
        "/v1/ai/humanitarian/verify",
        headers={"X-Org-Id": "org-a"},
        json=_payload(),
    )
    other_org = client.post(
        "/v1/ai/humanitarian/verify",
        headers={"X-Org-Id": "org-b"},
        json=_payload(),
    )

    assert first.status_code == other_org.status_code == 200
    assert "X-Verification-Cooldown" not in other_org.headers
    assert service.verify_claim.call_count == 2


def test_streaming_verification_observes_cooldown(verification_client, monkeypatch):
    client, service = verification_client
    monkeypatch.setattr(settings, "verification_cooldown_seconds", 60)
    now = [4000.0]
    monkeypatch.setattr(verification_cooldown, "_clock", lambda: now[0])
    headers = {"X-Org-Id": "org-cooldown-test"}
    url = "/v1/ai/humanitarian/verify?stream=true"

    first = client.post(url, headers=headers, json=_payload())
    now[0] += 5
    repeated = client.post(url, headers=headers, json=_payload())

    assert first.status_code == repeated.status_code == 200
    assert repeated.headers["X-Verification-Cooldown"] == "true"
    assert "event: result" in repeated.text
    assert service.verify_claim.call_count == 1
