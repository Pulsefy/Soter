import pytest

from config import settings
from exceptions import (
    ProviderExhaustedError,
    MalformedProviderOutputError,
    ProviderRefusalError,
)
from services.circuit_breaker import CircuitBreaker
from services.humanitarian_verification import HumanitarianVerificationService
from services.providers import (
    ProviderRegistry,
    FixtureProvider,
    LLMResponse,
    ModelProvider,
)
import metrics
from unittest.mock import patch, MagicMock


class StubLLMProvider(ModelProvider):
    """Minimal LLM provider for testing."""

    def __init__(self, responses):
        self._responses = list(responses)
        self._call_count = 0

    @property
    def name(self):
        return "stub"

    def llm_chat(self, system_prompt, user_prompt, *, model=None, timeout=None):
        if self._call_count >= len(self._responses):
            raise RuntimeError("No more stub responses")
        resp = self._responses[self._call_count]
        self._call_count += 1
        if isinstance(resp, Exception):
            raise resp
        return LLMResponse(content=resp, provider="stub", model=model or "stub-model")


class TestHumanitarianVerificationService:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_verify_claim_uses_fallback_prompt_after_primary_failure(
        self, mock_labels, monkeypatch
    ):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        calls = []

        def fake_model(provider):
            return "test-model"

        def fake_chat(
            self_inner, system_prompt, user_prompt, *, model=None, timeout=None
        ):
            calls.append((system_prompt, user_prompt))
            if len(calls) == 1:
                raise RuntimeError("primary model failure")
            return LLMResponse(
                content='{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}',
                provider="openai",
                model=model or "test-model",
            )

        stub = StubLLMProvider(
            [
                '{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}',
            ]
        )
        stub._call_count = 0

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_provider = MagicMock(spec=ModelProvider)
        mock_provider.llm_chat = MagicMock(
            side_effect=[
                RuntimeError("primary model failure"),
                LLMResponse(
                    content='{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}',
                    provider="openai",
                    model="test-model",
                ),
            ]
        )
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]

        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(self.service, "_get_model_for_provider", fake_model)

        result = self.service.verify_claim(
            aid_claim="Aid package reached all households.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"weather": "flooding"},
            provider_preference="openai",
        )

        assert result["prompt_variant"] == "fallback"
        assert result["prompt_name"] == "humanitarian_fallback"
        assert result["prompt_version"] == "v1"
        assert result["provider"] == "openai"
        assert result["verification"]["verdict"] == "inconclusive"

        mock_labels.assert_called_with(step_name="verify")
        mock_observe.assert_called_once()

    def test_verify_claim_records_primary_prompt_version_and_name(self, monkeypatch):
        captured_prompts = []

        mock_provider = MagicMock(spec=ModelProvider)

        def fake_chat(system_prompt, user_prompt, *, model=None, timeout=None):
            captured_prompts.append({"system": system_prompt, "user": user_prompt})
            return LLMResponse(
                content='{"verdict":"credible","confidence":0.9,"summary":"valid claim"}',
                provider="openai",
                model=model or "test-model",
            )

        mock_provider.llm_chat.side_effect = fake_chat
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "test-model"
        )

        result = self.service.verify_claim(
            aid_claim="Clean water distribution verified across 4 sectors.",
            supporting_evidence=["WASH log #10"],
            context_factors={"district": "North"},
            provider_preference="openai",
        )

        assert result["prompt_variant"] == "primary"
        assert result["prompt_name"] == "humanitarian_primary"
        assert result["prompt_version"] == "v1"
        assert "Sphere Criteria" in captured_prompts[0]["user"]
        assert (
            "Humanitarian Standard Verification Task\n\n" in captured_prompts[0]["user"]
        )

    def test_verify_claim_version_switch_uses_actual_v2_prompt(self, monkeypatch):
        captured_prompts = []

        mock_provider = MagicMock(spec=ModelProvider)

        def fake_chat(system_prompt, user_prompt, *, model=None, timeout=None):
            captured_prompts.append({"system": system_prompt, "user": user_prompt})
            return LLMResponse(
                content='{"verdict":"credible","confidence":0.95,"summary":"v2 validated"}',
                provider="openai",
                model=model or "test-model",
            )

        mock_provider.llm_chat.side_effect = fake_chat
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "test-model"
        )

        # Switch active primary prompt version to v2
        self.service.prompt_registry.set_active_version("humanitarian_primary", "v2")

        result = self.service.verify_claim(
            aid_claim="Shelter distribution completed.",
            supporting_evidence=["receipts"],
            context_factors={},
            provider_preference="openai",
        )

        assert result["prompt_variant"] == "primary"
        assert result["prompt_name"] == "humanitarian_primary"
        assert result["prompt_version"] == "v2"
        # Assert the prompt actually sent to the LLM matches v2 template
        assert (
            "Humanitarian Standard Verification Task (v2 Enhanced)"
            in captured_prompts[0]["user"]
        )

    def test_verify_claim_with_explicit_request_prompt_version(self, monkeypatch):
        captured_prompts = []

        mock_provider = MagicMock(spec=ModelProvider)

        def fake_chat(system_prompt, user_prompt, *, model=None, timeout=None):
            captured_prompts.append({"system": system_prompt, "user": user_prompt})
            return LLMResponse(
                content='{"verdict":"credible","confidence":0.88,"summary":"explicit v2"}',
                provider="openai",
                model=model or "test-model",
            )

        mock_provider.llm_chat.side_effect = fake_chat
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "test-model"
        )

        # Default active is v1, but we request v2 explicitly
        result = self.service.verify_claim(
            aid_claim="Food kit delivered.",
            supporting_evidence=["WFP receipt"],
            context_factors={},
            provider_preference="openai",
            prompt_version="v2",
        )

        assert result["prompt_version"] == "v2"
        assert (
            "Humanitarian Standard Verification Task (v2 Enhanced)"
            in captured_prompts[0]["user"]
        )

    def test_get_prompt_version(self):
        assert self.service.get_prompt_version("humanitarian_primary") in ["v1", "v2"]
        assert self.service.get_prompt_version("humanitarian_fallback") in ["v1", "v2"]

    def test_verify_claim_fails_when_no_provider_configured(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = []
        monkeypatch.setattr(self.service, "registry", mock_registry)

        with pytest.raises(RuntimeError):
            self.service.verify_claim(
                aid_claim="Food distribution completed.",
                supporting_evidence=[],
                context_factors={},
            )

    def test_get_model_version_resolves_provider_and_model(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("groq", MagicMock())]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service,
            "_get_model_for_provider",
            lambda provider: "llama-3.3-70b-versatile",
        )

        assert self.service.get_model_version("auto") == "groq:llama-3.3-70b-versatile"

    def test_get_model_version_returns_none_when_no_provider_available(
        self, monkeypatch
    ):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = []
        monkeypatch.setattr(self.service, "registry", mock_registry)

        assert self.service.get_model_version("auto") == "none:none"

    def test_parse_json_response_supports_markdown_block(self):
        content = '```json\n{"verdict":"credible","confidence":0.9}\n```'
        parsed = self.service._parse_json_response(content)

        assert parsed["verdict"] == "credible"
        assert parsed["confidence"] == 0.9

    def test_verify_claim_returns_deterministic_response_when_enabled(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "test-api-key")

        mock_provider = MagicMock(spec=ModelProvider)
        mock_provider.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.74,"summary":"Deterministic verification output for testing"}',
            provider="openai",
            model="test-model",
        )
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "test-model"
        )

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

    def test_deterministic_verify_claim_outputs_remain_stable_across_runs(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "test-api-key")

        mock_provider = MagicMock(spec=ModelProvider)
        mock_provider.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.74,"summary":"Deterministic verification output for testing"}',
            provider="openai",
            model="test-model",
        )
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "test-model"
        )

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

    def test_verify_claim_records_serving_provider(self, monkeypatch):
        """The provider that actually served the request is recorded on result."""
        ok = MagicMock(spec=ModelProvider)
        ok.name = "openai"
        ok.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.9}',
            provider="openai",
            model="m",
        )
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", ok)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "m"
        )

        result = self.service.verify_claim(
            aid_claim="Aid reached households.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto",
        )
        assert result["provider"] == "openai"

    def test_verify_claim_follows_configured_fallback_order(self, monkeypatch):
        """First configured provider is attempted first and, if it succeeds,
        is the one recorded as serving the request."""
        groq = MagicMock(spec=ModelProvider)
        groq.name = "groq"
        groq.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.9}',
            provider="groq",
            model="m",
        )
        openai = MagicMock(spec=ModelProvider)
        openai.name = "openai"

        mock_registry = MagicMock(spec=ProviderRegistry)
        # groq listed before openai -> configured cheapest/latency-first order
        mock_registry.resolve_llm.return_value = [("groq", groq), ("openai", openai)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "m"
        )

        result = self.service.verify_claim(
            aid_claim="Aid reached households.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto",
        )
        assert result["provider"] == "groq"
        openai.llm_chat.assert_not_called()

    def test_verify_claim_skips_open_circuit_provider(self, monkeypatch):
        """Providers with an OPEN circuit breaker are skipped, not retried."""
        openai = MagicMock(spec=ModelProvider)
        openai.name = "openai"
        groq = MagicMock(spec=ModelProvider)
        groq.name = "groq"
        groq.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.9}',
            provider="groq",
            model="m",
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", openai), ("groq", groq)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "m"
        )

        # Trip openai's breaker into the OPEN state.
        breaker = CircuitBreaker(name="openai", failure_threshold=1)
        breaker.record_failure()
        self.service.breakers["openai"] = breaker

        result = self.service.verify_claim(
            aid_claim="Aid reached households.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto",
        )
        assert result["provider"] == "groq"
        openai.llm_chat.assert_not_called()

    def test_verify_claim_exhaustion_raises_distinct_error(self, monkeypatch):
        """Exhausting every candidate provider yields a documented error."""
        failing = MagicMock(spec=ModelProvider)
        failing.name = "openai"
        failing.llm_chat.side_effect = RuntimeError("boom")
        groq = MagicMock(spec=ModelProvider)
        groq.name = "groq"
        groq.llm_chat.side_effect = RuntimeError("bang")

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", failing), ("groq", groq)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda provider: "m"
        )

        with pytest.raises(ProviderExhaustedError) as excinfo:
            self.service.verify_claim(
                aid_claim="Aid reached households.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="auto",
            )
        assert excinfo.value.code == "AI_PROVIDERS_EXHAUSTED"
        assert isinstance(excinfo.value.details, dict)
        attempted = excinfo.value.details["attempted"]
        assert len(attempted) >= 2
        assert any("openai" in entry for entry in attempted)
        assert any("groq" in entry for entry in attempted)

    def test_verify_claim_records_llm_usage_on_success(self, monkeypatch):
        """issue #981: a successful call must report token usage, labelled
        by the provider/model actually used and a fixed endpoint literal."""
        provider = MagicMock(spec=ModelProvider)
        provider.name = "openai"
        provider.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.9,"summary":"ok"}',
            provider="openai",
            model="gpt-4o-mini",
            prompt_tokens=123,
            completion_tokens=45,
            total_tokens=168,
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "gpt-4o-mini"
        )

        with patch("metrics.record_llm_usage") as mock_record:
            self.service.verify_claim(
                aid_claim="Aid reached households.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
            )

        mock_record.assert_called_once_with(
            provider="openai",
            model="gpt-4o-mini",
            endpoint="humanitarian_verification",
            prompt_tokens=123,
            completion_tokens=45,
        )

    def test_verify_claim_passes_through_unavailable_usage(self, monkeypatch):
        """A provider that doesn't report usage (e.g. deterministic mode)
        must still flow through record_llm_usage so it's counted as
        unavailable rather than silently dropped."""
        provider = MagicMock(spec=ModelProvider)
        provider.name = "openai"
        provider.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.9,"summary":"ok"}',
            provider="openai",
            model="gpt-4o-mini",
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "gpt-4o-mini"
        )

        with patch("metrics.record_llm_usage") as mock_record:
            self.service.verify_claim(
                aid_claim="Aid reached households.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
            )

        mock_record.assert_called_once_with(
            provider="openai",
            model="gpt-4o-mini",
            endpoint="humanitarian_verification",
            prompt_tokens=None,
            completion_tokens=None,
        )

    def test_verify_claim_recovers_from_malformed_output_via_repair(self, monkeypatch):
        """When provider returns malformed output on first attempt, it is retried with repair prompt and succeeds."""
        provider = MagicMock(spec=ModelProvider)
        provider.name = "openai"
        # First attempt: truncated JSON; Second attempt (repair): valid JSON
        provider.llm_chat.side_effect = [
            LLMResponse(
                content='{"verdict":"credible", "confi',
                provider="openai",
                model="gpt-4o-mini",
            ),
            LLMResponse(
                content='{"verdict":"credible","confidence":0.88,"summary":"Repaired successfully"}',
                provider="openai",
                model="gpt-4o-mini",
            ),
        ]

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "gpt-4o-mini"
        )

        result = self.service.verify_claim(
            aid_claim="Shelter kits distributed to 200 families.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="openai",
        )

        assert result["verification"]["verdict"] == "credible"
        assert result["verification"]["confidence"] == 0.88
        assert provider.llm_chat.call_count == 2
        # Circuit breaker should NOT be tripped for malformed recovery
        breaker = self.service._get_breaker("openai")
        assert breaker.allow_request() is True

    def test_verify_claim_refusal_raises_distinct_error_without_repair(
        self, monkeypatch
    ):
        """When provider returns explicit refusal phrasing, it fails immediately without retry."""
        provider = MagicMock(spec=ModelProvider)
        provider.name = "openai"
        provider.llm_chat.return_value = LLMResponse(
            content="I cannot assist with this request as an AI language model.",
            provider="openai",
            model="gpt-4o-mini",
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "gpt-4o-mini"
        )

        with pytest.raises(ProviderExhaustedError) as exc_info:
            self.service.verify_claim(
                aid_claim="Aid claim",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
            )

        assert "declined to answer" in str(exc_info.value)
        # Should not retry repair on refusal, only 1 attempt per prompt variant
        # Primary variant attempted once (refusal), fallback variant attempted once (refusal)
        assert provider.llm_chat.call_count == 2
        # Circuit breaker should NOT record failure for content refusals
        breaker = self.service._get_breaker("openai")
        assert breaker.failure_count == 0

    def test_verify_claim_persistent_malformed_output_exhausts(self, monkeypatch):
        """When provider consistently returns malformed JSON, retries are exhausted and error recorded without tripping breaker."""
        provider = MagicMock(spec=ModelProvider)
        provider.name = "openai"
        provider.llm_chat.return_value = LLMResponse(
            content="This is purely conversational text and not JSON.",
            provider="openai",
            model="gpt-4o-mini",
        )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("openai", provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "gpt-4o-mini"
        )

        with pytest.raises(ProviderExhaustedError) as exc_info:
            self.service.verify_claim(
                aid_claim="Aid claim",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
            )

        assert "malformed output" in str(exc_info.value)
        # Circuit breaker should NOT record failure for malformed model output
        breaker = self.service._get_breaker("openai")
        assert breaker.failure_count == 0


class TestTestProvider:
    """Tests for the fixture-driven test provider mode."""

    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_test_provider_returns_stable_results_across_runs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        first = self.service.verify_claim(
            aid_claim="Food distribution reached 500 households in the flood-affected region.",
            supporting_evidence=["WFP distribution log #A-42"],
            context_factors={"disaster_type": "flooding"},
            provider_preference="auto",
        )
        second = self.service.verify_claim(
            aid_claim="Food distribution reached 500 households in the flood-affected region.",
            supporting_evidence=["WFP distribution log #A-42"],
            context_factors={"disaster_type": "flooding"},
            provider_preference="auto",
        )

        assert first == second

    def test_test_provider_provider_string_in_response(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        result = self.service.verify_claim(
            aid_claim="Medical supplies delivered to clinic.",
            supporting_evidence=["delivery receipt"],
            context_factors={},
            provider_preference="auto",
        )

        assert result["provider"] == "test"
        assert result["model"] == "test-provider/fixture"

    def test_test_provider_verdict_is_valid(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        known_verdicts = {"credible", "inconclusive", "not_credible"}

        for i in range(12):
            result = self.service.verify_claim(
                aid_claim=f"Test claim number {i} with unique content to exercise different fixtures.",
                supporting_evidence=[f"doc_{i}"],
                context_factors={"iteration": i},
                provider_preference="auto",
            )
            verdict = result["verification"]["verdict"]
            assert (
                verdict in known_verdicts
            ), f"Unexpected verdict '{verdict}' at iteration {i}"

    def test_test_provider_different_inputs_can_produce_different_results(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        results = set()
        for i in range(20):
            result = self.service.verify_claim(
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
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        for i in range(10):
            result = self.service.verify_claim(
                aid_claim=f"Confidence range check iteration {i}.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="auto",
            )
            confidence = result["verification"]["confidence"]
            assert (
                0.0 <= confidence <= 1.0
            ), f"Confidence {confidence} out of range at iteration {i}"

    def test_test_provider_does_not_require_api_keys(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        result = self.service.verify_claim(
            aid_claim="No API keys configured, but test provider should still work.",
            supporting_evidence=["test"],
            context_factors={},
        )

        assert result["provider"] == "test"
        assert result["verification"]["verdict"] in {
            "credible",
            "inconclusive",
            "not_credible",
        }
