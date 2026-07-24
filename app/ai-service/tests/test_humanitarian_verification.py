import pytest
from unittest.mock import patch, MagicMock

from config import settings
from services.humanitarian_verification import HumanitarianVerificationService
from services.providers.base import LLMProvider
import metrics


# ---------------------------------------------------------------------------
# Mock provider helper
# ---------------------------------------------------------------------------

def _mock_provider(name, call_fn):
    """Return an LLMProvider stub whose .call() delegates to *call_fn*."""
    p = MagicMock(spec=LLMProvider)
    p.name = name
    p.call.side_effect = lambda model, system_prompt, user_prompt, timeout=None: call_fn(
        model, system_prompt, user_prompt, timeout
    )
    return p


def _mock_openai_provider(call_fn):
    return _mock_provider("openai", call_fn)


class TestHumanitarianVerificationService:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    @patch('metrics.PIPELINE_STEP_LATENCY.labels')
    def test_verify_claim_uses_fallback_prompt_after_primary_failure(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe
        
        calls = []

        def fake_call(model, system_prompt, user_prompt, timeout=None):
            calls.append((model, system_prompt, user_prompt))
            if len(calls) == 1:
                raise RuntimeError("primary model failure")
            return '{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}'

        mock_provider = _mock_openai_provider(fake_call)
        monkeypatch.setattr(self.service, "providers", [mock_provider])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")

        result = self.service.verify_claim(
            aid_claim="Aid package reached all households.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"weather": "flooding"},
            provider_preference="openai",
        )

        assert result["prompt_variant"] == "fallback"
        assert result["provider"] == "openai"
        assert result["verification"]["verdict"] == "inconclusive"
        assert len(calls) == 2
        
        mock_labels.assert_called_with(step_name='verify')
        mock_observe.assert_called_once()

    def test_verify_claim_fails_when_no_provider_configured(self, monkeypatch):
        monkeypatch.setattr(self.service, "providers", [])

        with pytest.raises(RuntimeError):
            self.service.verify_claim(
                aid_claim="Food distribution completed.",
                supporting_evidence=[],
                context_factors={},
            )

    def test_parse_json_response_supports_markdown_block(self):
        content = "```json\n{\"verdict\":\"credible\",\"confidence\":0.9}\n```"
        parsed = self.service._parse_json_response(content)

        assert parsed["verdict"] == "credible"
        assert parsed["confidence"] == 0.9

    def test_verify_claim_returns_deterministic_response_when_enabled(self, monkeypatch):
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "test-api-key")

        mock_provider = _mock_openai_provider(
            lambda model, sp, up, t=None: LLMProvider._get_deterministic_response()
        )
        monkeypatch.setattr(self.service, "providers", [mock_provider])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")

        result = self.service.verify_claim(
            aid_claim="Aid package reached all households.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"weather": "flooding"},
            provider_preference="openai",
        )

        assert result["provider"] == "openai"
        assert result["prompt_variant"] == "primary"
        assert result["verification"] == {
            "confidence": 0.74,
            "summary": "Deterministic verification output for testing",
            "verdict": "credible",
        }

    def test_deterministic_verify_claim_outputs_remain_stable_across_runs(self, monkeypatch):
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "test-api-key")

        mock_provider = _mock_openai_provider(
            lambda model, sp, up, t=None: LLMProvider._get_deterministic_response()
        )
        monkeypatch.setattr(self.service, "providers", [mock_provider])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")

        first_result = self.service.verify_claim(
            aid_claim="Emergency medical supplies delivered.",
            supporting_evidence=["field report"],
            context_factors={"region": "coastal"},
            provider_preference="openai",
        )
        second_result = self.service.verify_claim(
            aid_claim="Emergency medical supplies delivered.",
            supporting_evidence=["field report"],
            context_factors={"region": "coastal"},
            provider_preference="openai",
        )

        assert first_result == second_result


class TestTestProvider:
    """Tests for the fixture-driven test provider mode."""

    def _make_service_with_test_provider(self, monkeypatch):
        """Create a service wired to the TestLLMProvider."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)
        from services.providers import get_llm_providers
        return HumanitarianVerificationService(providers=get_llm_providers())

    def test_test_provider_returns_stable_results_across_runs(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)

        first = service.verify_claim(
            aid_claim="Food distribution reached 500 households in the flood-affected region.",
            supporting_evidence=["WFP distribution log #A-42"],
            context_factors={"disaster_type": "flooding"},
            provider_preference="auto",
        )
        second = service.verify_claim(
            aid_claim="Food distribution reached 500 households in the flood-affected region.",
            supporting_evidence=["WFP distribution log #A-42"],
            context_factors={"disaster_type": "flooding"},
            provider_preference="auto",
        )

        assert first == second

    def test_test_provider_provider_string_in_response(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)

        result = service.verify_claim(
            aid_claim="Medical supplies delivered to clinic.",
            supporting_evidence=["delivery receipt"],
            context_factors={},
            provider_preference="auto",
        )

        assert result["provider"] == "test"
        assert result["model"] == "test-provider/fixture"

    def test_test_provider_verdict_is_valid(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)
        known_verdicts = {"credible", "inconclusive", "not_credible"}

        for i in range(12):
            result = service.verify_claim(
                aid_claim=f"Test claim number {i} with unique content to exercise different fixtures.",
                supporting_evidence=[f"doc_{i}"],
                context_factors={"iteration": i},
                provider_preference="auto",
            )
            verdict = result["verification"]["verdict"]
            assert verdict in known_verdicts, (
                f"Unexpected verdict '{verdict}' at iteration {i}"
            )

    def test_test_provider_different_inputs_can_produce_different_results(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)
        results = set()
        for i in range(20):
            result = service.verify_claim(
                aid_claim=f"Unique aid claim description with varying details {i}.",
                supporting_evidence=[f"evidence_{i}"],
                context_factors={"seed": i},
                provider_preference="auto",
            )
            results.add(result["verification"]["verdict"])

        assert len(results) > 1, (
            "Test provider should produce more than one distinct verdict "
            "across different inputs"
        )

    def test_test_provider_confidence_in_expected_range(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)
        for i in range(10):
            result = service.verify_claim(
                aid_claim=f"Confidence range check iteration {i}.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="auto",
            )
            confidence = result["verification"]["confidence"]
            assert 0.0 <= confidence <= 1.0, (
                f"Confidence {confidence} out of range at iteration {i}"
            )

    def test_test_provider_does_not_require_api_keys(self, monkeypatch):
        service = self._make_service_with_test_provider(monkeypatch)
        result = service.verify_claim(
            aid_claim="No API keys configured, but test provider should still work.",
            supporting_evidence=["test"],
            context_factors={},
        )

        assert result["provider"] == "test"
        assert result["verification"]["verdict"] in {"credible", "inconclusive", "not_credible"}
