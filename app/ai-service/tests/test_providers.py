"""Tests for the provider interface (Issue #615)."""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from services.providers import (
    ModelProvider,
    ProviderRegistry,
    LLMResponse,
    OCRField,
    OCRResponse,
    OpenAIProvider,
    GroqProvider,
    FixtureProvider,
    TesseractOCRProvider,
)

# ---------------------------------------------------------------------------
# ModelProvider base class
# ---------------------------------------------------------------------------


class TestModelProviderBase:
    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            ModelProvider()

    def test_unsupported_llm_chat_raises(self):
        class DummyProvider(ModelProvider):
            @property
            def name(self):
                return "dummy"

        p = DummyProvider()
        with pytest.raises(NotImplementedError, match="does not support llm_chat"):
            p.llm_chat("sys", "usr")

    def test_unsupported_ocr_extract_raises(self):
        class DummyProvider(ModelProvider):
            @property
            def name(self):
                return "dummy"

        p = DummyProvider()
        with pytest.raises(NotImplementedError, match="does not support ocr_extract"):
            p.ocr_extract(None)


# ---------------------------------------------------------------------------
# LLMResponse / OCRResponse data classes
# ---------------------------------------------------------------------------


class TestResponseTypes:
    def test_llm_response_fields(self):
        r = LLMResponse(
            content="hello", provider="openai", model="gpt-4", latency_ms=100
        )
        assert r.content == "hello"
        assert r.provider == "openai"
        assert r.model == "gpt-4"
        assert r.latency_ms == 100

    def test_ocr_response_fields(self):
        fields = {"name": OCRField(value="John", confidence=0.9)}
        r = OCRResponse(
            fields=fields,
            raw_text="Name: John",
            processing_time_ms=50,
            provider="tesseract",
        )
        assert r.fields["name"].value == "John"
        assert r.raw_text == "Name: John"
        assert r.provider == "tesseract"


# ---------------------------------------------------------------------------
# TestLLMProvider
# ---------------------------------------------------------------------------


class TestFixtureProvider:
    def test_name(self):
        p = FixtureProvider()
        assert p.name == "test"

    def test_llm_chat_returns_json(self):
        p = FixtureProvider()
        resp = p.llm_chat("system prompt", "user prompt")
        assert isinstance(resp, LLMResponse)
        assert resp.provider == "test"
        assert resp.model == "test-provider/fixture"
        import json

        parsed = json.loads(resp.content)
        assert "verdict" in parsed

    def test_llm_chat_stable_for_same_input(self):
        p = FixtureProvider()
        r1 = p.llm_chat("sys", "usr")
        r2 = p.llm_chat("sys", "usr")
        assert r1.content == r2.content

    def test_name(self):
        p = FixtureProvider()
        assert p.name == "test"

    def test_ocr_extract_returns_response(self):
        p = FixtureProvider()
        mock_image = MagicMock()
        mock_image.size = (200, 100)
        resp = p.ocr_extract(mock_image)
        assert isinstance(resp, OCRResponse)
        assert resp.provider == "test"
        assert isinstance(resp.fields, dict)


# ---------------------------------------------------------------------------
# ProviderRegistry
# ---------------------------------------------------------------------------


class TestProviderRegistry:
    def setup_method(self):
        self.registry = ProviderRegistry()

    def test_register_and_get(self):
        class CustomProvider(ModelProvider):
            @property
            def name(self):
                return "custom"

        custom = CustomProvider()
        self.registry.register(custom)
        assert self.registry.get("custom") is custom

    def test_get_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown provider"):
            self.registry.get("nonexistent")

    def test_available_llm_providers_test_mode(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = True
            mock_settings.openai_api_key = None
            mock_settings.groq_api_key = None
            providers = self.registry.available_llm_providers()
            assert providers == ["test"]

    def test_available_llm_providers_all_configured(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            providers = self.registry.available_llm_providers()
            assert "openai" in providers
            assert "groq" in providers
            assert "test" not in providers

    def test_resolve_llm_auto_order(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            result = self.registry.resolve_llm("auto")
            names = [n for n, _ in result]
            assert "openai" in names
            assert "groq" in names

    def test_resolve_llm_preference_openai_first(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            result = self.registry.resolve_llm("openai")
            names = [n for n, _ in result]
            assert names[0] == "openai"

    def test_resolve_llm_preference_groq_first(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            mock_settings.openai_api_key = "key"
            mock_settings.groq_api_key = "key"
            result = self.registry.resolve_llm("groq")
            names = [n for n, _ in result]
            assert names[0] == "groq"

    def test_resolve_llm_test_only(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = True
            mock_settings.openai_api_key = None
            mock_settings.groq_api_key = None
            result = self.registry.resolve_llm("test")
            names = [n for n, _ in result]
            assert names == ["test"]

    def test_resolve_ocr_test_mode(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = True
            result = self.registry.resolve_ocr()
            names = [n for n, _ in result]
            assert names[0] == "test"
            assert "tesseract" in names

    def test_resolve_ocr_production(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.test_provider_mode = False
            result = self.registry.resolve_ocr()
            names = [n for n, _ in result]
            assert "tesseract" in names
            assert "test" not in names


# ---------------------------------------------------------------------------
# OpenAIProvider / GroqProvider (unit-level, mocked HTTP)
# ---------------------------------------------------------------------------


class TestOpenAIProvider:
    def test_name(self):
        assert OpenAIProvider().name == "openai"

    def test_llm_chat_no_key_raises(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = None
            with pytest.raises(RuntimeError, match="OpenAI API key is not configured"):
                OpenAIProvider().llm_chat("sys", "usr")

    def test_llm_chat_deterministic_mode(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "test-key"
            mock_settings.ai_deterministic_mode = True
            resp = OpenAIProvider().llm_chat("sys", "usr", model="gpt-4")
            assert resp.provider == "openai"
            assert "credible" in resp.content

    def test_llm_chat_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "test content"}}]
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "test-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = OpenAIProvider().llm_chat("sys", "usr", model="gpt-4")
                assert resp.content == "test content"
                assert resp.provider == "openai"


class TestGroqProvider:
    def test_name(self):
        assert GroqProvider().name == "groq"

    def test_llm_chat_no_key_raises(self):
        with patch("services.providers.settings") as mock_settings:
            mock_settings.groq_api_key = None
            with pytest.raises(RuntimeError, match="Groq API key is not configured"):
                GroqProvider().llm_chat("sys", "usr")
