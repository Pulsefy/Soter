"""Tests for the LLM + OCR provider interface introduced in issue #615.

The provider package exposes a clean abstract contract that lets
verification services swap backends without changing route logic.
These tests pin down the contract: who is registered, who is
attempted, how exceptions travel, and how the orchestration layer
delegates to the abstract interface.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any, Dict, List, Optional
from unittest.mock import patch

import pytest
from PIL import Image

from config import settings
from services.providers import (
    FixtureLLMProvider,
    FixtureOCRProvider,
    GroqProvider,
    LLMProvider,
    LLMProviderRegistry,
    LLMRequest,
    LLMResponse,
    OCRProvider,
    OCRProviderOutput,
    OCRProviderSelector,
    OCRRequest,
    OpenAIProvider,
    ProviderConfigurationError,
    ProviderConnectionError,
    ProviderResponseError,
    ProviderTimeoutError,
    TesseractOCRProvider,
    build_default_llm_registry,
    build_default_ocr_selector,
)
from services.providers.base import ProviderError
from services.humanitarian_verification import HumanitarianVerificationService


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


@dataclass
class FakeLLMResponse:
    content: str
    provider_name: str
    model: str
    raw: Dict[str, Any] = field(default_factory=dict)


class FakeLLMProvider(LLMProvider):
    """In-memory LLM provider used by registry/selector tests.

    Records every ``generate`` call so tests can assert ordering
    without depending on real OpenAI/Groq responses.
    """

    def __init__(self, name: str, model: str, content: str = "{}"):
        self.name = name
        self.model = model
        self._content = content
        self.calls: List[LLMRequest] = []
        self.fail_with: Optional[Exception] = None

    def generate(self, request: LLMRequest) -> LLMResponse:
        self.calls.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        return LLMResponse(
            content=self._content,
            provider_name=self.name,
            model=self.model,
        )


@dataclass
class FakeOCRResult:
    text: str
    processing_time_ms: int = 0


class FakeOCRProvider(OCRProvider):
    def __init__(self, name: str = "fake"):
        self.name = name
        self.calls: List[OCRRequest] = []

    def process(self, request: OCRRequest) -> OCRProviderOutput:
        self.calls.append(request)
        return OCRProviderOutput(
            raw_text=f"fake-ocr:{request.image.size}",
            processing_time_ms=42,
            word_data={"text": [f"fake-ocr:{request.image.size}"], "conf": [99]},
        )


class _Settings:
    """Minimal stand-in for ``config.Settings`` used by the registry."""

    def __init__(self, **kw: Any) -> None:
        for key, value in kw.items():
            setattr(self, key, value)

    # Defaults copied from ``config.Settings`` so the registry's
    # ``available()`` semantics keep working.
    test_provider_mode: bool = False
    openai_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    groq_model: str = "llama-3.3-70b-versatile"
    llm_timeout_seconds: int = 30
    ai_deterministic_mode: bool = False


# ---------------------------------------------------------------------------
# LLM contracts
# ---------------------------------------------------------------------------


class TestLLMProviderContract:
    def test_abstract_cannot_be_instantiated_directly(self):
        with pytest.raises(TypeError):
            LLMProvider()  # type: ignore[abstract]

    def test_concrete_provider_exposes_name_and_model(self):
        provider = FixtureLLMProvider()
        assert provider.name == "test"
        # FixtureLLMProvider advertises a stable model identifier so
        # response payloads and metrics consistently report it.
        assert provider.model == "test-provider/fixture"
        assert isinstance(provider, LLMProvider)

    def test_generate_returns_typed_response(self):
        provider = FixtureLLMProvider()
        response = provider.generate(
            LLMRequest(system_prompt="sys", user_prompt="user")
        )
        assert isinstance(response, LLMResponse)
        assert response.provider_name == "test"
        assert response.model


class TestExceptionHierarchy:
    def test_all_provider_errors_inherit_from_provider_error(self):
        for cls in (
            ProviderConfigurationError,
            ProviderConnectionError,
            ProviderTimeoutError,
            ProviderResponseError,
        ):
            assert issubclass(cls, ProviderError)

    def test_provider_error_carries_provider_name_and_details(self):
        exc = ProviderConnectionError(
            "boom", provider="openai", details={"status_code": 500}
        )
        assert exc.provider == "openai"
        assert exc.details == {"status_code": 500}
        assert "boom" in str(exc)


# ---------------------------------------------------------------------------
# Concrete LLM providers
# ---------------------------------------------------------------------------


class TestFixtureLLMProvider:
    def test_returns_deterministic_responses(self):
        provider = FixtureLLMProvider()
        first = provider.generate(
            LLMRequest(system_prompt="sys", user_prompt="hello")
        )
        second = provider.generate(
            LLMRequest(system_prompt="sys", user_prompt="hello")
        )
        assert first.content == second.content

    def test_response_is_serialisable_json(self):
        provider = FixtureLLMProvider()
        response = provider.generate(
            LLMRequest(system_prompt="s", user_prompt="u")
        )
        # Must be valid JSON; the humanitarian service parses this.
        import json

        parsed = json.loads(response.content)
        assert isinstance(parsed, dict)

    def test_provider_name_and_model_in_response(self):
        provider = FixtureLLMProvider()
        response = provider.generate(
            LLMRequest(system_prompt="s", user_prompt="u")
        )
        assert response.provider_name == "test"
        assert response.model == "test-provider/fixture"


class TestOpenAIProvider:
    def test_missing_api_key_raises_configuration_error(self):
        provider = OpenAIProvider(model="gpt-4o-mini", api_key=None)
        with pytest.raises(ProviderConfigurationError):
            provider.generate(LLMRequest(system_prompt="s", user_prompt="u"))

    def test_deterministic_flag_short_circuits_http(self, monkeypatch):
        provider = OpenAIProvider(
            model="gpt-4o-mini",
            api_key="test-key",
            deterministic_response='{"verdict":"credible"}',
        )
        with patch("httpx.Client") as client_cls:
            response = provider.generate(
                LLMRequest(
                    system_prompt="s",
                    user_prompt="u",
                    deterministic=True,
                )
            )
            client_cls.assert_not_called()
        assert "credible" in response.content

    def test_sends_request_with_bearer_token(self, monkeypatch):
        captured: Dict[str, Any] = {}

        class FakeClient:
            def __init__(self, timeout):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def post(self, url, json, headers):
                captured["url"] = url
                captured["json"] = json
                captured["headers"] = headers

                class FakeResponse:
                    def __init__(self):
                        self._data = {
                            "choices": [{"message": {"content": "ok"}}]
                        }

                    def raise_for_status(self):
                        return None

                    def json(self):
                        return self._data

                return FakeResponse()

        monkeypatch.setattr("httpx.Client", FakeClient)
        provider = OpenAIProvider(model="gpt-4o-mini", api_key="secret-key")
        response = provider.generate(
            LLMRequest(system_prompt="sys", user_prompt="user")
        )
        assert captured["headers"]["Authorization"] == "Bearer secret-key"
        assert captured["json"]["model"] == "gpt-4o-mini"
        assert response.content == "ok"


class TestGroqProvider:
    def test_uses_groq_base_url(self, monkeypatch):
        urls: List[str] = []

        class FakeClient:
            def __init__(self, timeout):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def post(self, url, json, headers):
                urls.append(url)

                class FakeResponse:
                    def __init__(self):
                        self._data = {
                            "choices": [{"message": {"content": "ok"}}]
                        }

                    def raise_for_status(self):
                        return None

                    def json(self):
                        return self._data

                return FakeResponse()

        monkeypatch.setattr("httpx.Client", FakeClient)
        provider = GroqProvider(
            model="llama-3.3-70b-versatile", api_key="groq-key"
        )
        response = provider.generate(
            LLMRequest(system_prompt="s", user_prompt="u")
        )
        assert any("groq" in url for url in urls)
        assert response.provider_name == "groq"
        assert response.model == "llama-3.3-70b-versatile"


# ---------------------------------------------------------------------------
# LLM registry
# ---------------------------------------------------------------------------


class TestLLMProviderRegistry:
    def test_available_returns_only_configured_providers(self):
        cfg = _Settings(openai_api_key="key")
        registry = LLMProviderRegistry(cfg)
        registry.register("openai", lambda c: OpenAIProvider("gpt", c.openai_api_key))
        assert registry.available() == ["openai"]

    def test_get_attempt_order_auto_returns_all_in_order(self):
        cfg = _Settings(
            openai_api_key="key", groq_api_key="key2", test_provider_mode=False
        )
        registry = LLMProviderRegistry(cfg)
        registry.register("openai", lambda c: OpenAIProvider("gpt", c.openai_api_key))
        registry.register("groq", lambda c: GroqProvider("llama", c.groq_api_key))
        order = registry.get_attempt_order("auto")
        assert [p.name for p in order] == ["openai", "groq"]

    def test_get_attempt_order_prefers_specific_provider(self):
        cfg = _Settings(openai_api_key="key", groq_api_key="key2")
        registry = LLMProviderRegistry(cfg)
        registry.register("openai", lambda c: OpenAIProvider("gpt", c.openai_api_key))
        registry.register("groq", lambda c: GroqProvider("llama", c.groq_api_key))
        order = registry.get_attempt_order("groq")
        assert [p.name for p in order] == ["groq", "openai"]

    def test_get_attempt_order_test_first_when_mode_enabled(self):
        cfg = _Settings(
            test_provider_mode=True,
            openai_api_key="key",
            groq_api_key="key2",
        )
        registry = LLMProviderRegistry(cfg)
        registry.register("openai", lambda c: OpenAIProvider("gpt", c.openai_api_key))
        registry.register("groq", lambda c: GroqProvider("llama", c.groq_api_key))
        registry.register("test", lambda c: FixtureLLMProvider())
        order = registry.get_attempt_order("auto")
        assert [p.name for p in order] == ["test", "openai", "groq"]

    def test_unknown_provider_raises_configuration_error(self):
        cfg = _Settings()
        registry = LLMProviderRegistry(cfg)
        with pytest.raises(Exception):
            registry.get("does-not-exist")

    def test_is_configured_returns_false_for_missing_keys(self):
        cfg = _Settings()  # no api keys, no test mode
        registry = LLMProviderRegistry(cfg)
        registry.register("openai", lambda c: OpenAIProvider("gpt", c.openai_api_key))
        assert registry.is_configured("openai") is False

    def test_instances_are_cached(self):
        cfg = _Settings(openai_api_key="key")
        registry = LLMProviderRegistry(cfg)
        registry.register(
            "openai",
            lambda c: OpenAIProvider("gpt", c.openai_api_key),
        )
        first = registry.get("openai")
        second = registry.get("openai")
        assert first is second


class TestBuildDefaultLLMRegistry:
    def test_registers_all_three_reference_providers(self):
        cfg = _Settings(
            openai_api_key="ok", groq_api_key="ok", test_provider_mode=False
        )
        registry = build_default_llm_registry(cfg)
        # The registry exposes all three reference factories.
        for name in ("openai", "groq", "test"):
            assert name in registry._factories
        assert [p.name for p in registry.get_attempt_order("auto")] == [
            "openai",
            "groq",
        ]

    def test_test_only_configuration_works_without_keys(self, monkeypatch):
        cfg = _Settings(
            test_provider_mode=True,
            openai_api_key=None,
            groq_api_key=None,
            ai_deterministic_mode=True,
        )
        monkeypatch.setattr(settings, "test_provider_mode", True)
        registry = build_default_llm_registry(cfg)
        # Only the fixture provider is attempted in auto mode.
        assert [p.name for p in registry.get_attempt_order("auto")] == [
            "test"
        ]


# ---------------------------------------------------------------------------
# OCR contracts and concrete providers
# ---------------------------------------------------------------------------


class TestOCRProviderContract:
    def test_abstract_cannot_be_instantiated_directly(self):
        with pytest.raises(TypeError):
            OCRProvider()  # type: ignore[abstract]

    def test_fixture_provider_returns_provider_output(self):
        provider = FixtureOCRProvider()
        img = Image.new("RGB", (50, 50), color="white")
        output = provider.process(OCRRequest(image=img))
        assert isinstance(output, OCRProviderOutput)
        assert output.raw_text != ""
        assert output.processing_time_ms >= 0


class TestTesseractOCRProvider:
    def test_uses_pytesseract_wrapped(self, monkeypatch):
        captured: Dict[str, Any] = {}

        def fake_image_to_data(image, config, output_type):
            captured["config"] = config
            return {
                "text": ["Hello", "World"],
                "conf": [90, 95],
                "left": [],
                "top": [],
            }

        import pytesseract

        monkeypatch.setattr(pytesseract, "image_to_data", fake_image_to_data)
        provider = TesseractOCRProvider()
        img = Image.new("RGB", (60, 30), color="white")
        output = provider.process(OCRRequest(image=img))
        assert "Hello World" in output.raw_text
        assert output.word_data["conf"] == [90, 95]
        assert captured["config"] == TesseractOCRProvider.DEFAULT_CONFIG

    def test_request_overrides_default_config(self, monkeypatch):
        captured: Dict[str, Any] = {}

        def fake_image_to_data(image, config, output_type):
            captured["config"] = config
            return {"text": [], "conf": []}

        import pytesseract

        monkeypatch.setattr(pytesseract, "image_to_data", fake_image_to_data)
        provider = TesseractOCRProvider()
        img = Image.new("RGB", (40, 40), color="white")
        provider.process(OCRRequest(image=img, config="--psm 7"))
        assert captured["config"] == "--psm 7"


class TestFixtureOCRProvider:
    def test_returns_raw_text_from_fixture(self):
        provider = FixtureOCRProvider()
        img = Image.new("RGB", (200, 100), color="white")
        output = provider.process(OCRRequest(image=img))
        assert isinstance(output, OCRProviderOutput)
        assert isinstance(output.raw_text, str)
        assert output.processing_time_ms >= 0

    def test_uses_test_provider_for_fixture_loading(self):
        # Replace the underlying TestProvider to verify it's the source
        # of truth for fixtures.
        from services.test_provider import TestProvider

        captured: Dict[str, Any] = {}

        class SpyProvider(TestProvider):
            def get_response(self, endpoint, request_data):
                captured["endpoint"] = endpoint
                captured["request_data"] = request_data
                return {
                    "raw_text": "stubbed",
                    "processing_time_ms": 7,
                    "fields": {},
                }

        provider = FixtureOCRProvider(test_provider=SpyProvider())
        img = Image.new("RGB", (10, 10), color="white")
        output = provider.process(OCRRequest(image=img))
        assert captured["endpoint"] == "ocr"
        assert output.raw_text == "stubbed"
        assert output.processing_time_ms == 7


class TestOCRProviderSelector:
    def test_test_mode_returns_fixture(self, monkeypatch):
        cfg = _Settings(test_provider_mode=True)
        selector = OCRProviderSelector(cfg)
        assert isinstance(selector.get(), FixtureOCRProvider)

    def test_default_returns_tesseract(self):
        cfg = _Settings(test_provider_mode=False)
        selector = OCRProviderSelector(cfg)
        assert isinstance(selector.get(), TesseractOCRProvider)

    def test_override_takes_precedence(self):
        cfg = _Settings(test_provider_mode=False)
        selector = OCRProviderSelector(cfg, override="fixture")
        assert isinstance(selector.get(), FixtureOCRProvider)

    def test_unknown_override_raises(self):
        cfg = _Settings(test_provider_mode=False)
        selector = OCRProviderSelector(cfg, override="mystery")
        with pytest.raises(ValueError):
            selector.get()

    def test_get_caches_provider(self):
        cfg = _Settings(test_provider_mode=False)
        selector = OCRProviderSelector(cfg)
        first = selector.get()
        second = selector.get()
        assert first is second


# ---------------------------------------------------------------------------
# Humanitarian verification service integration
# ---------------------------------------------------------------------------


class TestHumanitarianVerificationServiceViaRegistry:
    """Confirm refactored service works with a custom registry.

    This is the "swap without refactors" promise: a different registry
    built with different providers should drive ``verify_claim``
    through the new abstraction without changing route code.
    """

    def _make_registry(self):
        cfg = _Settings(
            test_provider_mode=True,
            openai_api_key=None,
            groq_api_key=None,
            ai_deterministic_mode=False,
        )
        registry = LLMProviderRegistry(cfg)
        registry.register(
            "test",
            lambda c: FakeLLMProvider(
                "test",
                "fake-model",
                content='{"verdict":"credible","confidence":0.9,"summary":"stub"}',
            ),
        )
        return registry

    def test_verify_claim_iterates_registry_providers(self):
        registry = self._make_registry()
        service = HumanitarianVerificationService(llm_registry=registry)
        result = service.verify_claim(
            aid_claim="Family received food rations in disaster zone.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"region": "north"},
            provider_preference="auto",
        )
        assert result["provider"] == "test"
        assert result["model"] == "fake-model"
        assert result["verification"]["verdict"] == "credible"

    def test_circuit_breaker_skips_open_provider(self):
        cfg = _Settings(
            test_provider_mode=True,
            openai_api_key=None,
            groq_api_key=None,
            ai_deterministic_mode=False,
        )
        failing = FakeLLMProvider(
            "test",
            "fake-model",
            content='{"verdict":"credible","confidence":0.7,"summary":"x"}',
        )
        failing.fail_with = ProviderTimeoutError("boom", provider="test")
        # Successful fallback provider.
        success = FakeLLMProvider(
            "fallback",
            "fake-model",
            content='{"verdict":"credible","confidence":0.7,"summary":"x"}',
        )
        registry = LLMProviderRegistry(cfg)
        registry.register("test", lambda c: failing)
        registry.register("fallback", lambda c: success)
        # Force both providers to be visible to the registry.
        cfg.test_provider_mode = False  # override to keep 'fallback' as unknown name
        # Manually override ``available`` for this test.
        registry.available = lambda: ["test", "fallback"]

        service = HumanitarianVerificationService(llm_registry=registry)
        service.breakers["test"].record_failure()
        service.breakers["test"].record_failure()
        service.breakers["test"].record_failure()
        # Open the breaker so 'test' is skipped.
        service.breakers["test"].failure_count = 99

        result = service.verify_claim(
            aid_claim="Test claim.",
            supporting_evidence=[],
            context_factors={},
        )
        assert result["provider"] == "fallback"

    def test_verify_claim_surfaces_provider_errors(self):
        cfg = _Settings(test_provider_mode=True)
        bad = FakeLLMProvider("test", "fake", content="{}")
        bad.fail_with = ProviderConnectionError(
            "refused", provider="test", details={"status_code": 500}
        )
        registry = LLMProviderRegistry(cfg)
        registry.register("test", lambda c: bad)
        service = HumanitarianVerificationService(llm_registry=registry)
        with pytest.raises(Exception):
            service.verify_claim(
                aid_claim="Test.",
                supporting_evidence=[],
                context_factors={},
            )

    def test_registry_can_be_swapped_without_route_changes(self, monkeypatch):
        """Regression: routes delegate to ``_main.humanitarian_verification_service``;
        swapping the service's internal registry must not change observable behaviour.
        """
        import main

        cfg = _Settings(
            test_provider_mode=True,
            ai_deterministic_mode=True,
        )
        registry = LLMProviderRegistry(cfg)
        registry.register("test", lambda c: FixtureLLMProvider())

        human = HumanitarianVerificationService(llm_registry=registry)
        # Re-bind the singleton to ensure route handlers see the new service.
        monkeypatch.setattr(main, "humanitarian_verification_service", human)

        client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(
            main.app
        )
        response = client.post(
            "/v1/ai/humanitarian/verify",
            json={
                "aid_claim": "Family received shelter materials after the storm.",
                "supporting_evidence": ["field report"],
                "context_factors": {},
                "provider_preference": "auto",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["provider"] == "test"
        assert "verification" in data
