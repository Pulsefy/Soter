"""Tests for the LLM provider abstraction."""

import json

import pytest
from unittest.mock import patch, MagicMock

from config import settings
from services.providers.base import LLMProvider
from services.providers.openai_provider import OpenAIProvider
from services.providers.groq_provider import GroqProvider
from services.providers.test_llm_provider import TestLLMProvider
from services.providers import get_llm_providers


# ---------------------------------------------------------------------------
# Base class contract
# ---------------------------------------------------------------------------

class TestLLMProviderContract:
    """Verify the abstract base class enforces the contract."""

    def test_cannot_instantiate_abstract_class(self):
        with pytest.raises(TypeError):
            LLMProvider()  # type: ignore[abstract]

    def test_concrete_subclass_instantiates(self):
        provider = OpenAIProvider(api_key="sk-test")
        assert provider.name == "openai"
        assert provider._base_url == "https://api.openai.com/v1/chat/completions"
        assert provider._api_key == "sk-test"

    def test_deterministic_response_is_valid_json(self):
        raw = LLMProvider._get_deterministic_response()
        parsed = json.loads(raw)
        assert parsed["verdict"] == "credible"
        assert parsed["confidence"] == 0.74


# ---------------------------------------------------------------------------
# OpenAIProvider — the reference implementation
# ---------------------------------------------------------------------------

class TestOpenAIProvider:
    def test_name_is_openai(self):
        p = OpenAIProvider(api_key="sk-test")
        assert p.name == "openai"

    def test_uses_settings_api_key_when_none_provided(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "env-key")
        p = OpenAIProvider()
        assert p._api_key == "env-key"

    def test_uses_constructor_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "env-key")
        p = OpenAIProvider(api_key="ctor-key")
        assert p._api_key == "ctor-key"

    def test_call_raises_without_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", None)
        p = OpenAIProvider(api_key=None)
        with pytest.raises(RuntimeError, match="API key is not configured"):
            p.call("gpt-4", "sys", "user")

    @patch("httpx.Client.post")
    def test_call_returns_content(self, mock_post, monkeypatch):
        monkeypatch.setattr(settings, "ai_deterministic_mode", False)
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Hello from AI"}}]
        }
        mock_post.return_value = mock_response

        p = OpenAIProvider(api_key="sk-test")
        result = p.call("gpt-4o-mini", "sys prompt", "user prompt")
        assert result == "Hello from AI"


# ---------------------------------------------------------------------------
# GroqProvider
# ---------------------------------------------------------------------------

class TestGroqProvider:
    def test_name_is_groq(self):
        p = GroqProvider(api_key="grq-test")
        assert p.name == "groq"

    def test_base_url(self):
        p = GroqProvider(api_key="grq-test")
        assert "groq.com" in p._base_url


# ---------------------------------------------------------------------------
# TestLLMProvider
# ---------------------------------------------------------------------------

class TestTestLLMProvider:
    def test_name_is_test(self):
        p = TestLLMProvider()
        assert p.name == "test"

    def test_call_returns_valid_json(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        p = TestLLMProvider()
        result = p.call("any-model", "sys", "user")
        parsed = json.loads(result)
        assert isinstance(parsed, dict)

    def test_call_is_deterministic(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        p = TestLLMProvider()
        first = p.call("m", "sys", "hello world")
        second = p.call("m", "sys", "hello world")
        assert first == second

    def test_does_not_use_http(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        p = TestLLMProvider()
        assert p._base_url == ""
        assert p._api_key is None
        # Should not raise
        result = p.call("m", "sys", "user")
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------

class TestGetLLMProviders:
    def test_returns_test_when_test_mode(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        providers = get_llm_providers()
        names = [p.name for p in providers]
        assert "test" in names
        assert "openai" not in names
        assert "groq" not in names

    def test_returns_openai_when_key_set(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", False)
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        monkeypatch.setattr(settings, "groq_api_key", None)

        providers = get_llm_providers()
        names = [p.name for p in providers]
        assert "openai" in names
        assert "test" not in names
        assert "groq" not in names

    def test_returns_multiple_when_multiple_configured(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        monkeypatch.setattr(settings, "groq_api_key", "grq-test")

        providers = get_llm_providers()
        names = [p.name for p in providers]
        assert len(providers) >= 3
        assert "test" in names
        assert "openai" in names
        assert "groq" in names

    def test_preference_moves_provider_to_front(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        monkeypatch.setattr(settings, "groq_api_key", None)

        providers = get_llm_providers(provider_preference="openai")
        assert providers[0].name == "openai"

    def test_unknown_preference_returns_all(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        providers = get_llm_providers(provider_preference="unknown")
        assert len(providers) == 1
        assert providers[0].name == "test"

    def test_returns_empty_when_nothing_configured(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", False)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        providers = get_llm_providers()
        assert len(providers) == 0
