import pytest

from config import Settings


def test_ai_deterministic_mode_can_be_enabled_from_environment(monkeypatch):
    monkeypatch.setenv("AI_DETERMINISTIC_MODE", "true")

    settings = Settings()

    assert settings.ai_deterministic_mode is True
