import logging

import pytest

from config import ConfigurationError, Settings

_ISOLATED_ENV_KEYS = (
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "TEST_PROVIDER_MODE",
    "AI_DETERMINISTIC_MODE",
    "APP_ENV",
    "LOG_LEVEL",
    "AI_WEBHOOK_SECRET",
    "REDIS_URL",
    "REQUEST_RATE_LIMIT",
    "DEAD_LETTER_REPLAY_RATE_LIMIT",
    "CORS_ALLOWED_ORIGINS",
    "CORS_CUSTOM_ORIGINS",
    "PROOF_OF_LIFE_CONFIDENCE_THRESHOLD",
    "PROOF_OF_LIFE_MIN_FACE_SIZE",
    "LLM_TIMEOUT_SECONDS",
    "CACHE_TTL_TASK_STATUS",
    "PORT",
)


def _isolate_env(monkeypatch):
    """Clear config env vars so tests are hermetic regardless of host setup."""
    for key in _ISOLATED_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


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


def test_malformed_webhook_url_fails_validation(monkeypatch):
    monkeypatch.setenv("BACKEND_WEBHOOK_URL", "not-a-url")
    with pytest.raises(ValueError):
        Settings()


# ---------------------------------------------------------------------------
# Startup configuration validation (issue #987)
# ---------------------------------------------------------------------------


def test_validate_configuration_passes_with_valid_settings(monkeypatch):
    _isolate_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-valid-key-for-unit-tests")

    settings = Settings(_env_file=None)

    settings.validate_configuration()


def test_validate_configuration_passes_with_all_defaults():
    settings = Settings(_env_file=None)

    settings.validate_configuration()


def test_missing_and_malformed_keys_reported_together(monkeypatch):
    _isolate_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "   ")
    monkeypatch.setenv("AI_WEBHOOK_SECRET", "change-me-to-a-strong-random-secret")
    monkeypatch.setenv("REDIS_URL", "postgres://db.internal:5432/soter")
    monkeypatch.setenv("REQUEST_RATE_LIMIT", "ten per minute")

    settings = Settings(_env_file=None)

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert "OPENAI_API_KEY" in message
    assert "AI_WEBHOOK_SECRET" in message
    assert "REDIS_URL" in message
    assert "REQUEST_RATE_LIMIT" in message


def test_error_message_never_contains_secret_values(monkeypatch):
    _isolate_env(monkeypatch)
    weak_secret = "tiny-key"
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("AI_WEBHOOK_SECRET", weak_secret)

    settings = Settings(_env_file=None)

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert weak_secret not in message
    assert weak_secret not in repr(excinfo.value)


def test_weak_callback_secret_is_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    monkeypatch.setenv("TEST_PROVIDER_MODE", "true")
    monkeypatch.setenv("AI_WEBHOOK_SECRET", "short")

    settings = Settings(_env_file=None)

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "AI_WEBHOOK_SECRET" in str(excinfo.value)


def test_blank_provider_key_is_malformed(monkeypatch):
    _isolate_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "")

    settings = Settings(_env_file=None)

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "OPENAI_API_KEY" in str(excinfo.value)


def test_missing_provider_in_production_names_every_option(monkeypatch):
    _isolate_env(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    settings = Settings(_env_file=None)

    # Simulate promoting an already-constructed development config to production.
    settings.app_env = "production"

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert "OPENAI_API_KEY" in message
    assert "GROQ_API_KEY" in message
    assert "TEST_PROVIDER_MODE" in message


def test_fallback_order_defaults_validate(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.validate_configuration()
    assert settings.get_llm_fallback_order() == ["openai", "groq", "test"]
    assert settings.get_ocr_fallback_order() == ["test", "tesseract"]


def test_invalid_llm_fallback_order_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_provider_fallback_order = "openai,bogus"

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert "LLM_PROVIDER_FALLBACK_ORDER" in message
    assert "bogus" in message


def test_duplicate_llm_fallback_order_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_provider_fallback_order = "openai,openai"

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "LLM_PROVIDER_FALLBACK_ORDER" in str(excinfo.value)


def test_empty_llm_fallback_order_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_provider_fallback_order = ""

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "LLM_PROVIDER_FALLBACK_ORDER" in str(excinfo.value)


def test_default_llm_model_cost_rates_validate(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.validate_configuration()
    assert "gpt-4o-mini" in settings.llm_model_cost_per_1k_tokens
    assert "llama-3.3-70b-versatile" in settings.llm_model_cost_per_1k_tokens


def test_negative_llm_model_cost_rate_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_model_cost_per_1k_tokens = {
        "some-model": {"prompt": -0.001, "completion": 0.002},
    }

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert "LLM_MODEL_COST_PER_1K_TOKENS" in message
    assert "some-model" in message
    assert "prompt" in message


def test_llm_model_cost_rate_missing_direction_rejected(monkeypatch):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_model_cost_per_1k_tokens = {
        "partial-model": {"prompt": 0.001},
    }

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    message = str(excinfo.value)
    assert "LLM_MODEL_COST_PER_1K_TOKENS" in message
    assert "partial-model" in message
    assert "completion" in message


def test_empty_llm_model_cost_rates_still_validates(monkeypatch):
    """An empty rate table is valid - it just means no model has a known
    cost yet, not a configuration error (issue #981: an unrated model
    results in no cost estimate, not a validation failure)."""
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)
    settings.llm_model_cost_per_1k_tokens = {}
    settings.validate_configuration()


def test_boot_report_logs_defaults_at_debug_level(monkeypatch, caplog):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)

    config_logger = logging.getLogger("config")
    with caplog.at_level(logging.DEBUG, logger="config"):
        settings.report_boot_configuration(config_logger)

    text = caplog.text
    assert "config default PORT=8000" in text
    assert "config default LOG_LEVEL='INFO'" in text
    # HOST is reported with its default value; when main.py has installed the
    # RedactionFilter the IPv4 value itself is masked, which is acceptable.
    assert (
        "config default HOST='0.0.0.0'" in text
        or "config default HOST='[REDACTED]'" in text
    )


def test_boot_report_never_logs_secret_values(monkeypatch, caplog):
    _isolate_env(monkeypatch)
    secret = "sk-super-secret-do-not-log-value"
    monkeypatch.setenv("OPENAI_API_KEY", secret)
    settings = Settings(_env_file=None)

    config_logger = logging.getLogger("config")
    with caplog.at_level(logging.DEBUG, logger="config"):
        settings.report_boot_configuration(config_logger)

    text = caplog.text
    assert secret not in text
    # Presence is reported either verbatim or pre-redacted by the
    # RedactionFilter installed by main.py - never with the real value.
    assert "OPENAI_API_KEY=<set>" in text or "OPENAI_API_KEY=[REDACTED]" in text


def test_boot_report_marks_unset_secrets(monkeypatch, caplog):
    _isolate_env(monkeypatch)
    settings = Settings(_env_file=None)

    config_logger = logging.getLogger("config")
    with caplog.at_level(logging.DEBUG, logger="config"):
        settings.report_boot_configuration(config_logger)

    assert (
        "AI_WEBHOOK_SECRET=<unset>" in caplog.text
        or "AI_WEBHOOK_SECRET=[REDACTED]" in caplog.text
    )
