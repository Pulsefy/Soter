import pytest

from config import Settings


def test_ai_deterministic_mode_can_be_enabled_from_environment(monkeypatch):
    monkeypatch.setenv("AI_DETERMINISTIC_MODE", "true")

    settings = Settings()

    assert settings.ai_deterministic_mode is True


def test_test_provider_mode_can_be_enabled_from_environment(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_MODE", "true")

    settings = Settings()

    assert settings.test_provider_mode is True


def test_test_provider_mode_defaults_to_false():
    settings = Settings()

    assert settings.test_provider_mode is False


def test_active_provider_returns_test_when_test_provider_mode_enabled(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_MODE", "true")

    settings = Settings()

    assert settings.get_active_provider() == "test"


def test_validate_api_keys_returns_true_when_test_provider_mode(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_MODE", "true")

    settings = Settings()

    assert settings.validate_api_keys() is True


def test_staging_environment_defaults_to_safe_test_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("TEST_PROVIDER_MODE", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    monkeypatch.delenv("AI_DETERMINISTIC_MODE", raising=False)

    settings = Settings()

    assert settings.app_env == "staging"
    assert settings.test_provider_mode is True
    assert settings.ai_deterministic_mode is True
    assert settings.request_rate_limit == "5/minute"
    assert settings.log_level == "INFO"
    assert settings.get_active_provider() == "test"


def test_production_environment_requires_provider_configuration(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("TEST_PROVIDER_MODE", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)

    with pytest.raises(ValueError):
        Settings()


def test_production_environment_allows_test_provider_when_enabled(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("TEST_PROVIDER_MODE", "true")

    settings = Settings()

    assert settings.get_active_provider() == "test"
