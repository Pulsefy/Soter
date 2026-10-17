"""
Startup validation tests (issue #987).

Verifies that an invalid configuration aborts the FastAPI lifespan so the
service never starts serving traffic, and that a valid configuration boots.
Additionally verifies the prompt registry health check for active versions.
"""

import pytest
from fastapi.testclient import TestClient

import config
import main
from config import ConfigurationError


def test_invalid_configuration_prevents_startup(monkeypatch):
    def _raise(self):
        raise ConfigurationError(
            "Invalid configuration:\n  - REDIS_URL: must use redis:// scheme"
        )

    # Patch on the class: pydantic instances reject non-field attributes.
    monkeypatch.setattr(config.Settings, "validate_configuration", _raise)

    with pytest.raises(ConfigurationError):
        with TestClient(main.app):
            pass  # lifespan raises before the app can serve any request


def test_valid_configuration_boots_and_serves():
    with TestClient(main.app) as client:
        response = client.get("/health")
        assert response.status_code == 200

    # ``app.ai-service.main.app`` is a module-level singleton shared by every test file in
    # the session. Exiting the context manager above runs the lifespan
    # shutdown path, which permanently flips ``is_shutting_down`` to True.
    # Other test modules build a plain (non-context-manager) TestClient
    # around the same app and never re-enter the lifespan, so without this
    # reset they would start seeing 503 "draining" responses regardless of
    # test order.
    main.app.state.is_shutting_down = False


def test_health_reports_prompt_registry_ok():
    """The /health endpoint must report the prompt registry as healthy when
    every known prompt name resolves to a valid active version."""
    with TestClient(main.app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        prompts = body.get("prompts")
        assert prompts is not None
        assert prompts["status"] == "ok"
        assert prompts["missing"] == []

    main.app.state.is_shutting_down = False


def test_health_reports_misconfigured_prompt(monkeypatch):
    """A missing or invalid active version must be reported as degraded
    with a clear message naming the affected prompt."""
    from prompts import registry as prompt_registry

    prompt_name = "test_misconfigured_prompt"
    original = dict(prompt_registry._active_versions)

    def _broken_active_versions():
        broken = dict(original)
        broken[prompt_name] = "does-not-exist"
        return broken

    monkeypatch.setattr(
        prompt_registry,
        "_active_versions",
        _broken_active_versions,
    )

    try:
        with TestClient(main.app) as client:
            response = client.get("/health")
            assert response.status_code == 503
            body = response.json()
            assert body["status"] == "degraded"
            prompts = body["prompts"]
            assert prompts["status"] == "degraded"
            assert prompt_name in prompts["missing"]
            assert prompt_name in body["message"]
    finally:
        main.app.state.is_shutting_down = False
