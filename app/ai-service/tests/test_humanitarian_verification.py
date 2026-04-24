import pytest

from config import settings
from services.humanitarian_verification import HumanitarianVerificationService
import metrics
from unittest.mock import patch, MagicMock


class TestHumanitarianVerificationService:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    @patch('metrics.PIPELINE_STEP_LATENCY.labels')
    def test_verify_claim_uses_fallback_prompt_after_primary_failure(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe
        
        calls = []

        def fake_attempt_order(provider_preference):
            return ["openai"]

        def fake_model(provider):
            return "test-model"

        def fake_call_provider(provider, model, system_prompt, user_prompt):
            calls.append((provider, model, system_prompt, user_prompt))
            if len(calls) == 1:
                raise RuntimeError("primary model failure")
            return '{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}'

        monkeypatch.setattr(self.service, "_provider_attempt_order", fake_attempt_order)
        monkeypatch.setattr(self.service, "_get_model_for_provider", fake_model)
        monkeypatch.setattr(self.service, "_call_provider", fake_call_provider)

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
        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda provider_preference: [])

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

        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda provider_preference: ["openai"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda provider: "test-model")

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

        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda provider_preference: ["openai"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda provider: "test-model")

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
