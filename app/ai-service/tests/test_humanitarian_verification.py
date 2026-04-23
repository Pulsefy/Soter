import pytest

from services.humanitarian_verification import HumanitarianVerificationService


class TestHumanitarianVerificationService:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_verify_claim_uses_fallback_prompt_after_primary_failure(self, monkeypatch):
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
