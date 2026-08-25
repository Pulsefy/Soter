"""Tests for configurable provider fallback order (Issue #982).

Acceptance criteria covered:
- Fallback order is defined in configuration and validated at startup
- The provider that actually served a request is recorded on the result
- Providers with an open circuit are skipped rather than retried
- Exhausting all providers yields a distinct, documented error
- Tests cover ordering, skipping, and exhaustion
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch

from config import Settings, ConfigurationError
from exceptions import AllProvidersExhaustedError
from services.circuit_breaker import CircuitBreaker
from services.providers import ProviderRegistry, LLMResponse, ModelProvider
from services.humanitarian_verification import HumanitarianVerificationService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_breaker(state: str = "CLOSED") -> CircuitBreaker:
    """Return a CircuitBreaker pre-set to the given state."""
    b = CircuitBreaker("test", failure_threshold=3, recovery_timeout=60.0)
    b.state = state
    return b


def _make_llm_provider(
    name: str, content: str = '{"verdict":"credible","confidence":0.9,"summary":"ok"}'
) -> ModelProvider:
    """Return a mock ModelProvider that succeeds with ``content``."""
    mock = MagicMock(spec=ModelProvider)
    mock.name = name
    mock.llm_chat.return_value = LLMResponse(
        content=content, provider=name, model=f"{name}-model"
    )
    return mock


def _make_failing_provider(
    name: str, error: Exception = RuntimeError("boom")
) -> ModelProvider:
    """Return a mock ModelProvider whose llm_chat always raises ``error``."""
    mock = MagicMock(spec=ModelProvider)
    mock.name = name
    mock.llm_chat.side_effect = error
    return mock


# ---------------------------------------------------------------------------
# 1. Configuration validation for LLM_PROVIDER_ORDER
# ---------------------------------------------------------------------------


class TestLLMProviderOrderConfigValidation:
    """validate_configuration() must reject bad LLM_PROVIDER_ORDER values."""

    def _build_valid_settings(self, **overrides):
        """Return a Settings instance that passes validation for non-order fields."""
        defaults = dict(
            openai_api_key="sk-test",
            groq_api_key=None,
            app_env="development",
            redis_url="redis://localhost:6379/0",
            request_rate_limit="10/minute",
            dead_letter_replay_rate_limit="10/minute",
            llm_timeout_seconds=30,
            cache_ttl_task_status=30,
            cache_ttl_artifact_access=60,
            cache_ttl_verification=120,
            task_retry_delay_seconds=30,
            verification_artifact_url_ttl_seconds=300,
            proof_of_life_min_face_size=80,
            proof_of_life_confidence_threshold=0.65,
            port=8000,
            cors_allowed_origins="",
            cors_custom_origins="",
        )
        defaults.update(overrides)
        # Construct directly, bypassing env file loading.
        return Settings.model_construct(**defaults)

    def test_valid_order_single(self):
        s = self._build_valid_settings(llm_provider_order="openai")
        s.validate_configuration()  # must not raise

    def test_valid_order_multiple(self):
        s = self._build_valid_settings(llm_provider_order="groq,openai")
        s.validate_configuration()  # must not raise

    def test_valid_order_all_known(self):
        s = self._build_valid_settings(llm_provider_order="test,openai,groq")
        s.validate_configuration()

    def test_none_order_is_allowed(self):
        s = self._build_valid_settings(llm_provider_order=None)
        s.validate_configuration()

    def test_unknown_provider_rejected(self):
        s = self._build_valid_settings(llm_provider_order="openai,badprovider")
        with pytest.raises(ConfigurationError, match="LLM_PROVIDER_ORDER"):
            s.validate_configuration()

    def test_duplicate_provider_rejected(self):
        s = self._build_valid_settings(llm_provider_order="openai,openai")
        with pytest.raises(ConfigurationError, match="LLM_PROVIDER_ORDER"):
            s.validate_configuration()

    def test_blank_order_rejected(self):
        s = self._build_valid_settings(llm_provider_order="   ")
        with pytest.raises(ConfigurationError, match="LLM_PROVIDER_ORDER"):
            s.validate_configuration()

    def test_parsed_order_returns_list(self):
        s = self._build_valid_settings(llm_provider_order="groq,openai")
        assert s.parsed_llm_provider_order() == ["groq", "openai"]

    def test_parsed_order_none_returns_empty(self):
        s = self._build_valid_settings(llm_provider_order=None)
        assert s.parsed_llm_provider_order() == []


# ---------------------------------------------------------------------------
# 2. ProviderRegistry respects configured order
# ---------------------------------------------------------------------------


class TestProviderRegistryOrder:
    """available_llm_providers() must honour LLM_PROVIDER_ORDER."""

    def setup_method(self):
        self.registry = ProviderRegistry()

    def _patch_settings(
        self, test_mode=False, openai_key=None, groq_key=None, order=None
    ):
        m = MagicMock()
        m.test_provider_mode = test_mode
        m.openai_api_key = openai_key
        m.groq_api_key = groq_key
        m.parsed_llm_provider_order.return_value = (
            [e.strip() for e in order.split(",") if e.strip()] if order else []
        )
        return m

    def test_implicit_order_when_no_config(self):
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = []
            providers = self.registry.available_llm_providers()
        # Both present; openai comes before groq in legacy implicit order
        assert providers.index("openai") < providers.index("groq")

    def test_configured_order_groq_first(self):
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = ["groq", "openai"]
            providers = self.registry.available_llm_providers()
        assert providers == ["groq", "openai"]

    def test_configured_order_openai_first(self):
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = ["openai", "groq"]
            providers = self.registry.available_llm_providers()
        assert providers == ["openai", "groq"]

    def test_configured_order_drops_unavailable_provider(self):
        """Providers in the order list that aren't configured are silently dropped."""
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = None  # groq not available
            ms.parsed_llm_provider_order.return_value = ["groq", "openai"]
            providers = self.registry.available_llm_providers()
        assert providers == ["openai"]  # groq absent because no key

    def test_configured_order_appends_unlisted_available_providers(self):
        """Providers available but not in the explicit list are appended as safety net."""
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = ["openai"]  # groq not listed
            providers = self.registry.available_llm_providers()
        assert providers[0] == "openai"
        assert "groq" in providers  # groq appended

    def test_test_mode_prepends_test_provider(self):
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = True
            ms.openai_api_key = None
            ms.groq_api_key = None
            ms.parsed_llm_provider_order.return_value = []
            providers = self.registry.available_llm_providers()
        assert providers == ["test"]


# ---------------------------------------------------------------------------
# 3. resolve_llm respects configured order and breaker_map
# ---------------------------------------------------------------------------


class TestResolveWithBreakerMap:
    def setup_method(self):
        self.registry = ProviderRegistry()

    def _base_settings(self):
        m = MagicMock()
        m.test_provider_mode = False
        m.openai_api_key = "key"
        m.groq_api_key = "key"
        m.parsed_llm_provider_order.return_value = []
        return m

    def test_resolve_llm_skips_open_circuit_via_breaker_map(self):
        openai_breaker = _make_breaker("OPEN")
        groq_breaker = _make_breaker("CLOSED")
        breaker_map = {"openai": openai_breaker, "groq": groq_breaker}

        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = []
            result = self.registry.resolve_llm("auto", breaker_map=breaker_map)

        names = [n for n, _ in result]
        assert "openai" not in names, "Open-circuit openai should be skipped"
        assert "groq" in names

    def test_resolve_llm_no_breaker_map_returns_all(self):
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = []
            result = self.registry.resolve_llm("auto")

        names = [n for n, _ in result]
        assert "openai" in names
        assert "groq" in names

    def test_resolve_llm_all_open_returns_empty(self):
        openai_breaker = _make_breaker("OPEN")
        groq_breaker = _make_breaker("OPEN")
        breaker_map = {"openai": openai_breaker, "groq": groq_breaker}

        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = []
            result = self.registry.resolve_llm("auto", breaker_map=breaker_map)

        assert result == []

    def test_resolve_ocr_skips_open_circuit(self):
        test_breaker = _make_breaker("OPEN")
        breaker_map = {"test": test_breaker}

        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = True
            result = self.registry.resolve_ocr("auto", breaker_map=breaker_map)

        names = [n for n, _ in result]
        assert "test" not in names
        assert "tesseract" in names

    def test_resolve_llm_configured_order_respected(self):
        """The configured order is honoured even inside resolve_llm."""
        with patch("services.providers.settings") as ms:
            ms.test_provider_mode = False
            ms.openai_api_key = "key"
            ms.groq_api_key = "key"
            ms.parsed_llm_provider_order.return_value = ["groq", "openai"]
            result = self.registry.resolve_llm("auto")

        names = [n for n, _ in result]
        assert names[0] == "groq"
        assert names[1] == "openai"


# ---------------------------------------------------------------------------
# 4. HumanitarianVerificationService — provider recorded on result
# ---------------------------------------------------------------------------


class TestVerifyClaimProviderRecorded:
    """The result dict must always carry a ``provider`` key."""

    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_provider_field_present_on_success(self, monkeypatch):
        openai_provider = _make_llm_provider("openai")
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", openai_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        result = self.service.verify_claim(
            aid_claim="Food aid reached target demographic.",
            supporting_evidence=[],
            context_factors={},
        )

        assert "provider" in result
        assert result["provider"] == "openai"

    def test_provider_field_reflects_fallback_provider(self, monkeypatch):
        """When the first provider fails, the result reflects the fallback provider."""
        failing = _make_failing_provider("openai")
        succeeding = _make_llm_provider("groq")

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", failing),
            ("groq", succeeding),
        ]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        result = self.service.verify_claim(
            aid_claim="Aid delivered on time.",
            supporting_evidence=[],
            context_factors={},
        )

        assert result["provider"] == "groq"
        failing.llm_chat.assert_called()
        succeeding.llm_chat.assert_called()


# ---------------------------------------------------------------------------
# 5. Open-circuit providers are skipped
# ---------------------------------------------------------------------------


class TestOpenCircuitSkipped:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_open_circuit_provider_is_skipped(self, monkeypatch):
        monkeypatch.setattr("config.settings.openai_api_key", "key")
        monkeypatch.setattr("config.settings.groq_api_key", "key")
        monkeypatch.setattr("config.settings.test_provider_mode", False)
        monkeypatch.setattr("config.settings.ai_deterministic_mode", False)

        openai_mock = _make_llm_provider("openai")
        groq_mock = _make_llm_provider("groq")

        # Pre-open openai's breaker.
        openai_breaker = self.service._get_breaker("openai")
        openai_breaker.failure_threshold = 1
        openai_breaker.record_failure()
        assert openai_breaker.state == "OPEN"

        mock_registry = MagicMock(spec=ProviderRegistry)
        # Simulate registry filtering out openai because its breaker is OPEN.
        mock_registry.resolve_llm.return_value = [("groq", groq_mock)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        result = self.service.verify_claim(
            aid_claim="Supplies distributed correctly.",
            supporting_evidence=[],
            context_factors={},
        )

        openai_mock.llm_chat.assert_not_called()
        assert result["provider"] == "groq"

    def test_breakers_passed_to_resolve_llm(self, monkeypatch):
        """verify_claim must pass its internal breaker dict to resolve_llm."""
        mock_registry = MagicMock(spec=ProviderRegistry)
        groq_mock = _make_llm_provider("groq")
        mock_registry.resolve_llm.return_value = [("groq", groq_mock)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        self.service.verify_claim(
            aid_claim="Emergency rations provided.",
            supporting_evidence=[],
            context_factors={},
        )

        # resolve_llm must have been called with breaker_map keyword argument.
        call_kwargs = mock_registry.resolve_llm.call_args.kwargs
        assert "breaker_map" in call_kwargs
        # The breaker_map must be the service's own breakers dict.
        assert call_kwargs["breaker_map"] is self.service.breakers


# ---------------------------------------------------------------------------
# 6. AllProvidersExhaustedError raised when all fail
# ---------------------------------------------------------------------------


class TestAllProvidersExhausted:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_all_providers_fail_raises_distinct_error(self, monkeypatch):
        failing_openai = _make_failing_provider("openai")
        failing_groq = _make_failing_provider("groq")

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", failing_openai),
            ("groq", failing_groq),
        ]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            self.service.verify_claim(
                aid_claim="Ration cards verified.",
                supporting_evidence=[],
                context_factors={},
            )

        err = exc_info.value
        assert isinstance(err, AllProvidersExhaustedError)
        assert "openai" in err.providers_tried
        assert "groq" in err.providers_tried
        assert len(err.errors) > 0

    def test_no_providers_configured_raises_distinct_error(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = []  # nothing available
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        with pytest.raises(AllProvidersExhaustedError):
            self.service.verify_claim(
                aid_claim="No providers configured.",
                supporting_evidence=[],
                context_factors={},
            )

    def test_exhausted_error_is_not_plain_runtime_error(self, monkeypatch):
        """AllProvidersExhaustedError must be its own class, not RuntimeError."""
        failing = _make_failing_provider("openai")
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", failing)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        with pytest.raises(AllProvidersExhaustedError):
            self.service.verify_claim(
                aid_claim="Single provider exhausted.",
                supporting_evidence=[],
                context_factors={},
            )

    def test_exhausted_error_message_contains_provider_names(self, monkeypatch):
        failing_openai = _make_failing_provider("openai", RuntimeError("network error"))
        failing_groq = _make_failing_provider("groq", RuntimeError("timeout"))

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", failing_openai),
            ("groq", failing_groq),
        ]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            self.service.verify_claim(
                aid_claim="Error context test.",
                supporting_evidence=[],
                context_factors={},
            )

        msg = str(exc_info.value)
        # The message should identify the exhausted providers and contain errors.
        assert "openai" in msg or "groq" in msg

    def test_all_providers_circuit_open_raises_exhausted(self, monkeypatch):
        """When resolve_llm returns empty due to all open circuits, raise AllProvidersExhaustedError."""
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = []  # all filtered out
        monkeypatch.setattr(self.service, "registry", mock_registry)

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            self.service.verify_claim(
                aid_claim="All circuits open.",
                supporting_evidence=[],
                context_factors={},
            )

        err = exc_info.value
        assert err.providers_tried == []


# ---------------------------------------------------------------------------
# 7. AllProvidersExhaustedError class properties
# ---------------------------------------------------------------------------


class TestAllProvidersExhaustedErrorClass:
    def test_is_exception(self):
        e = AllProvidersExhaustedError()
        assert isinstance(e, Exception)

    def test_not_runtime_error(self):
        e = AllProvidersExhaustedError()
        assert not isinstance(e, RuntimeError)

    def test_default_empty_lists(self):
        e = AllProvidersExhaustedError()
        assert e.providers_tried == []
        assert e.errors == []

    def test_providers_and_errors_stored(self):
        e = AllProvidersExhaustedError(
            providers_tried=["openai", "groq"],
            errors=["openai: boom", "groq: crash"],
        )
        assert e.providers_tried == ["openai", "groq"]
        assert e.errors == ["openai: boom", "groq: crash"]

    def test_default_message_contains_provider_names(self):
        e = AllProvidersExhaustedError(providers_tried=["openai", "groq"], errors=[])
        assert "openai" in str(e)
        assert "groq" in str(e)

    def test_custom_message_accepted(self):
        e = AllProvidersExhaustedError(message="custom error msg")
        assert str(e) == "custom error msg"
