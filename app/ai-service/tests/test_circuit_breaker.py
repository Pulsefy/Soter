import pytest
import time
import httpx
from unittest.mock import patch, MagicMock

from services.circuit_breaker import CircuitBreaker
from services.humanitarian_verification import HumanitarianVerificationService
from services.providers import ProviderRegistry, LLMResponse, ModelProvider
from exceptions import AIServiceError
from config import settings


def test_circuit_breaker_basic_transitions():
    # Set a short recovery timeout for fast testing
    breaker = CircuitBreaker("test-provider", failure_threshold=2, recovery_timeout=0.1)

    # 1. Starts CLOSED
    assert breaker.state == "CLOSED"
    assert breaker.allow_request() is True

    # 2. First failure
    breaker.record_failure()
    assert breaker.state == "CLOSED"  # Not tripped yet
    assert breaker.allow_request() is True

    # 3. Second failure (reaches threshold)
    breaker.record_failure()
    assert breaker.state == "OPEN"
    assert breaker.allow_request() is False  # Tripped

    # 4. Wait for recovery timeout
    time.sleep(0.12)

    # 5. Transitions to HALF_OPEN on allow_request check
    assert breaker.allow_request() is True
    assert breaker.state == "HALF_OPEN"

    # 6. Success closes the circuit
    breaker.record_success()
    assert breaker.state == "CLOSED"
    assert breaker.failure_count == 0


def test_circuit_breaker_half_open_failure():
    breaker = CircuitBreaker("test-provider", failure_threshold=2, recovery_timeout=0.1)

    # Trip the breaker
    breaker.record_failure()
    breaker.record_failure()
    assert breaker.state == "OPEN"

    # Wait for recovery timeout
    time.sleep(0.12)
    assert breaker.allow_request() is True
    assert breaker.state == "HALF_OPEN"

    # Failure in HALF_OPEN trips it immediately to OPEN
    breaker.record_failure()
    assert breaker.state == "OPEN"
    assert breaker.allow_request() is False


class TestHumanitarianVerificationServiceCircuitBreaker:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_verify_claim_skips_provider_when_circuit_open(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", "test-key")
        monkeypatch.setattr(settings, "test_provider_mode", False)
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)

        mock_openai = MagicMock(spec=ModelProvider)
        mock_openai.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.8,"summary":"test"}',
            provider="openai",
            model="test-model",
        )
        mock_groq = MagicMock(spec=ModelProvider)
        mock_groq.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.8,"summary":"test"}',
            provider="groq",
            model="test-model",
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [
            ("openai", mock_openai),
            ("groq", mock_groq),
        ]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        openai_breaker = self.service._get_breaker("openai")
        openai_breaker.failure_threshold = 2
        openai_breaker.record_failure()
        openai_breaker.record_failure()
        assert openai_breaker.state == "OPEN"

        result = self.service.verify_claim(
            aid_claim="Food aid reached target demographic.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto",
        )

        mock_openai.llm_chat.assert_not_called()
        mock_groq.llm_chat.assert_called()
        assert result["provider"] == "groq"

    def test_request_timeout_raises_ai_timeout(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", None)
        monkeypatch.setattr(settings, "test_provider_mode", False)
        monkeypatch.setattr(settings, "ai_deterministic_mode", False)

        mock_openai = MagicMock(spec=ModelProvider)
        mock_openai.llm_chat.side_effect = AIServiceError(
            message="LLM request timed out after 1.5s",
            code="AI_TIMEOUT",
            details={"provider": "openai", "timeout_seconds": 1.5},
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_openai)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        with pytest.raises(RuntimeError) as exc_info:
            self.service.verify_claim(
                aid_claim="Food aid reached target demographic.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
                timeout=1.5,
            )

        assert "AI_TIMEOUT" in str(exc_info.value)
        assert "LLM request timed out after 1.5s" in str(exc_info.value)

        breaker = self.service._get_breaker("openai")
        assert breaker.failure_count == 2

    def test_all_providers_unavailable_false_without_configured_providers(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)
        monkeypatch.setattr(settings, "test_provider_mode", False)

        assert self.service.all_providers_unavailable() is False

    def test_all_providers_unavailable_true_when_all_breakers_open(self, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", "test-key")
        monkeypatch.setattr(settings, "test_provider_mode", False)

        openai_breaker = self.service._get_breaker("openai")
        groq_breaker = self.service._get_breaker("groq")
        openai_breaker.failure_threshold = 2
        groq_breaker.failure_threshold = 2
        openai_breaker.record_failure()
        openai_breaker.record_failure()
        groq_breaker.record_failure()
        groq_breaker.record_failure()

        assert self.service.all_providers_unavailable() is True
