import pytest
import time
import httpx
from unittest.mock import patch, MagicMock

from services.circuit_breaker import CircuitBreaker
from services.humanitarian_verification import HumanitarianVerificationService
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
        # Set short recovery timeout and threshold for testing
        for breaker in self.service.breakers.values():
            breaker.failure_threshold = 2
            breaker.recovery_timeout = 0.1

    def test_verify_claim_skips_provider_when_circuit_open(self, monkeypatch):
        # Configure service to use both openai and groq
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", "test-key")
        
        # Mock provider attempt order to try openai first, then groq
        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda pref: ["openai", "groq"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")
        
        # Trip the openai breaker
        openai_breaker = self.service.breakers["openai"]
        openai_breaker.record_failure()
        openai_breaker.record_failure()
        assert openai_breaker.state == "OPEN"
        
        # Mock _call_provider for both
        calls = []
        def fake_call_provider(provider, model, system_prompt, user_prompt, timeout=None):
            calls.append(provider)
            return '{"verdict": "credible", "confidence": 0.8, "summary": "test"}'
            
        monkeypatch.setattr(self.service, "_call_provider", fake_call_provider)
        
        # Execute verification
        result = self.service.verify_claim(
            aid_claim="Food aid reached target demographic.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto"
        )
        
        # openai should have been skipped entirely (no call made to openai)
        assert "openai" not in calls
        assert "groq" in calls
        assert result["provider"] == "groq"

    @patch("httpx.Client.post")
    def test_request_timeout_raises_ai_timeout(self, mock_post, monkeypatch):
        # Configure key to enable openai
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda pref: ["openai"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")
        
        # Mock httpx.Client.post to raise a timeout
        mock_post.side_effect = httpx.TimeoutException("Connection timed out")
        
        with pytest.raises(RuntimeError) as exc_info:
            self.service.verify_claim(
                aid_claim="Food aid reached target demographic.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
                timeout=1.5
            )
            
        # The exception raised inside verify_claim loop should be caught, recorded as failure,
        # and since all providers fail, a RuntimeError is raised containing the error.
        assert "AI_TIMEOUT" in str(exc_info.value)
        assert "LLM request timed out after 1.5s" in str(exc_info.value)
        
        # The breaker for openai should have recorded the failure
        assert self.service.breakers["openai"].failure_count == 2  # Primary & fallback attempts both failed
