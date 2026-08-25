"""Tests for explicit, configurable provider fallback order (issue #982).

Acceptance criteria verified here:
  1. Fallback order is defined in configuration and validated at startup.
  2. The provider that actually served a request is recorded on the result.
  3. Providers with an open circuit are skipped rather than retried.
  4. Exhausting all providers yields AllProvidersExhaustedError.
  5. Tests cover ordering, circuit-skip, and exhaustion.
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch

from config import Settings, ConfigurationError
from exceptions import AIServiceError, AllProvidersExhaustedError
from services.providers import LLMResponse, ModelProvider, ProviderRegistry
from services.humanitarian_verification import HumanitarianVerificationService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_llm_response(provider: str) -> LLMResponse:
    return LLMResponse(
        content='{"verdict":"credible","confidence":0.9,"summary":"ok"}',
        provider=provider,
        model="test-model",
    )


def _make_failing_provider(name: str) -> MagicMock:
    mock = MagicMock(spec=ModelProvider)
    mock.name = name
    mock.llm_chat.side_effect = AIServiceError(
        message=f"{name} unavailable", code="AI_PROVIDER_ERROR"
    )
    return mock


def _make_successful_provider(name: str) -> MagicMock:
    mock = MagicMock(spec=ModelProvider)
    mock.name = name
    mock.llm_chat.return_value = _make_llm_response(name)
    return mock


# ---------------------------------------------------------------------------
# 1. Configuration validation — LLM_PROVIDER_ORDER field
# ---------------------------------------------------------------------------

class TestLLMProviderOrderConfig:
    """Startup validation of LLM_PROVIDER_ORDER."""

    def test_valid_order_passes_validation(self):
        s = Settings(
            openai_api_key="key",
            groq_api_key="key",
            llm_provider_order=["groq", "openai"],
            redis_url="redis://localhost:6379/0",
        )
        # Should not raise
        s.validate_configuration()

    def test_empty_order_passes_validation(self):
        s = Settings(
            openai_api_key="key",
            redis_url="redis://localhost:6379/0",
        )
        s.validate_configuration()

    def test_unknown_provider_fails_validation(self):
        s = Settings(
            openai_api_key="key",
            llm_provider_order=["openai", "unknown_provider"],
            redis_url="redis://localhost:6379/0",
        )
        with pytest.raises(ConfigurationError, match="LLM_PROVIDER_ORDER"):
            s.validate_configuration()

    def test_single_entry_valid_order(self):
        s = Settings(
            groq_api_key="key",
            llm_provider_order=["groq"],
            redis_url="redis://localhost:6379/0",
        )
        s.validate_configuration()

    def test_comma_string_parsed_to_list(self):
        """Env-var style comma-separated string is coerced to a list."""
        # Simulate what pydantic-settings does when reading from env
        s = Settings.model_validate(
            {
                "llm_provider_order": "groq,openai",
                "redis_url": "redis://localhost:6379/0",
            }
        )
        assert s.llm_provider_order == ["groq", "openai"]


# ---------------------------------------------------------------------------
# 2. served_by is populated on LLMResponse
# ---------------------------------------------------------------------------

class TestServedByField:
    def test_served_by_equals_provider(self):
        resp = LLMResponse(content="hi", provider="openai", model="gpt-4")
        assert resp.served_by == "openai"

    def test_served_by_equals_provider_for_groq(self):
        resp = LLMResponse(content="hi", provider="groq", model="llama")
        assert resp.served_by == "groq"

    def test_served_by_present_in_verify_claim_result(self, monkeypatch):
        service = HumanitarianVerificationService()

        mock_provider = _make_successful_provider("groq")
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("groq", mock_provider)]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        result = service.verify_claim(
            aid_claim="Food aid delivered",
            supporting_evidence=[],
            context_factors={},
            provider_preference="groq",
        )

        assert "served_by" in result
        assert result["served_by"] == "groq"
        assert result["provider"] == "groq"


# ---------------------------------------------------------------------------
# 3. Configured order is respected under "auto"
# ---------------------------------------------------------------------------

class TestProviderOrderRespected:
    """resolve_llm() must follow settings.llm_provider_order when pref==auto."""

    def test_groq_first_when_configured(self):
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = ["groq", "openai"]

            result = registry.resolve_llm("auto")
            names = [n for n, _ in result]

        assert names[0] == "groq"
        assert names[1] == "openai"

    def test_openai_first_when_configured(self):
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = ["openai", "groq"]

            result = registry.resolve_llm("auto")
            names = [n for n, _ in result]

        assert names[0] == "openai"
        assert names[1] == "groq"

    def test_implicit_order_when_no_config(self):
        """When llm_provider_order is empty, code-default order is used."""
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = []

            result = registry.resolve_llm("auto")
            names = [n for n, _ in result]

        assert set(names) == {"openai", "groq"}

    def test_unavailable_provider_in_order_is_skipped(self):
        """A provider listed in llm_provider_order but not configured is silently dropped."""
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = None   # openai has no key
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = ["openai", "groq"]  # openai listed first

            result = registry.resolve_llm("auto")
            names = [n for n, _ in result]

        # openai is dropped; groq remains
        assert names == ["groq"]

    def test_extra_available_providers_appended(self):
        """Providers not in llm_provider_order but available are appended at the end."""
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = ["groq"]   # openai not listed

            result = registry.resolve_llm("auto")
            names = [n for n, _ in result]

        assert names[0] == "groq"
        assert "openai" in names  # appended

    def test_explicit_preference_overrides_configured_order(self):
        """An explicit non-auto preference ignores llm_provider_order."""
        registry = ProviderRegistry()
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            mock_settings.llm_provider_order = ["groq", "openai"]

            result = registry.resolve_llm("openai")
            names = [n for n, _ in result]

        assert names[0] == "openai"

    def test_verify_claim_respects_configured_order(self, monkeypatch):
        """End-to-end: groq is called first when llm_provider_order=groq,openai."""
        service = HumanitarianVerificationService()

        call_order: list[str] = []

        def groq_chat(*args, **kwargs):
            call_order.append("groq")
            return _make_llm_response("groq")

        def openai_chat(*args, **kwargs):
            call_order.append("openai")
            return _make_llm_response("openai")

        mock_groq = MagicMock(spec=ModelProvider)
        mock_groq.llm_chat.side_effect = groq_chat
        mock_openai = MagicMock(spec=ModelProvider)
        mock_openai.llm_chat.side_effect = openai_chat

        mock_registry = MagicMock(spec=ProviderRegistry)
        # Simulate resolve_llm returning groq first (as configured order)
        mock_registry.resolve_llm.return_value = [
            ("groq", mock_groq),
            ("openai", mock_openai),
        ]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        result = service.verify_claim(
            aid_claim="Water aid delivered",
            provider_preference="auto",
        )

        assert call_order[0] == "groq"
        assert result["served_by"] == "groq"
        mock_openai.llm_chat.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Open circuit breakers are skipped
# ---------------------------------------------------------------------------

class TestCircuitBreakerSkip:
    """Providers with open circuits must be skipped, not retried."""

    def test_open_circuit_provider_is_skipped(self, monkeypatch):
        service = HumanitarianVerificationService()

        mock_openai = _make_successful_provider("openai")
        mock_groq = _make_successful_provider("groq")

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", mock_openai),
            ("groq", mock_groq),
        ]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        # Trip the openai circuit
        openai_breaker = service._get_breaker("openai")
        openai_breaker.failure_threshold = 1
        openai_breaker.record_failure()
        assert openai_breaker.state == "OPEN"

        result = service.verify_claim(
            aid_claim="Shelter kits distributed",
            provider_preference="auto",
        )

        mock_openai.llm_chat.assert_not_called()
        mock_groq.llm_chat.assert_called()
        assert result["provider"] == "groq"
        assert result["served_by"] == "groq"

    def test_skipped_provider_in_attempted_list(self, monkeypatch):
        """AllProvidersExhaustedError.attempted_providers marks skipped entries."""
        service = HumanitarianVerificationService()

        mock_openai = _make_failing_provider("openai")
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_openai)]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        # Trip the openai circuit by marking failures directly
        openai_breaker = service._get_breaker("openai")
        openai_breaker.failure_threshold = 1
        openai_breaker.record_failure()

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            service.verify_claim(aid_claim="test")

        attempted = exc_info.value.attempted_providers
        assert any("(skipped)" in a for a in attempted), (
            f"Expected a skipped entry in attempted_providers, got: {attempted}"
        )


# ---------------------------------------------------------------------------
# 5. AllProvidersExhaustedError on total exhaustion
# ---------------------------------------------------------------------------

class TestAllProvidersExhausted:
    """Exhausting all providers must raise AllProvidersExhaustedError."""

    def test_all_providers_fail_raises_exhausted(self, monkeypatch):
        service = HumanitarianVerificationService()

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", _make_failing_provider("openai")),
            ("groq", _make_failing_provider("groq")),
        ]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            service.verify_claim(
                aid_claim="No providers work",
                provider_preference="auto",
            )

        err = exc_info.value
        assert err.code == "ALL_PROVIDERS_EXHAUSTED"
        assert "openai" in err.attempted_providers
        assert "groq" in err.attempted_providers
        assert len(err.per_provider_errors) > 0

    def test_no_providers_configured_raises_exhausted(self, monkeypatch):
        service = HumanitarianVerificationService()

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = []  # nothing configured
        monkeypatch.setattr(service, "registry", mock_registry)

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            service.verify_claim(aid_claim="test")

        assert exc_info.value.code == "ALL_PROVIDERS_EXHAUSTED"
        assert exc_info.value.attempted_providers == []

    def test_exhausted_error_is_subclass_of_ai_service_error(self):
        err = AllProvidersExhaustedError(
            attempted_providers=["openai", "groq"],
            per_provider_errors=["openai: timeout", "groq: 500"],
        )
        assert isinstance(err, AIServiceError)

    def test_exhausted_error_message_contains_providers(self):
        err = AllProvidersExhaustedError(
            attempted_providers=["openai", "groq"],
            per_provider_errors=["openai: timeout", "groq: 500"],
        )
        msg = str(err)
        assert "openai" in msg
        assert "groq" in msg

    def test_all_open_circuits_raises_exhausted(self, monkeypatch):
        service = HumanitarianVerificationService()

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", _make_successful_provider("openai")),
            ("groq", _make_successful_provider("groq")),
        ]
        monkeypatch.setattr(service, "registry", mock_registry)
        monkeypatch.setattr(service, "_get_model_for_provider", lambda p: "test-model")

        # Trip both circuits
        for name in ("openai", "groq"):
            b = service._get_breaker(name)
            b.failure_threshold = 1
            b.record_failure()

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            service.verify_claim(aid_claim="all open circuits")

        err = exc_info.value
        assert err.code == "ALL_PROVIDERS_EXHAUSTED"
        # Both entries should be in the attempted list, prefixed with "(skipped)"
        assert all("(skipped)" in a for a in err.attempted_providers)
