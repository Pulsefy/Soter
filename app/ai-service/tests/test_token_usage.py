"""Tests for LLM token usage & cost accounting (Issue #981)."""

import pytest
from prometheus_client import REGISTRY
from unittest.mock import MagicMock, patch

from services import providers
from services.providers import (
    LLMResponse,
    OpenAIProvider,
    estimate_token_cost_usd,
    record_llm_token_usage,
    usage_endpoint,
)


def _sample(name: str, labels: dict) -> float:
    value = REGISTRY.get_sample_value(name, labels)
    return 0.0 if value is None else float(value)


def _assert_delta(
    sample_name: str, labels: dict, expected: float, fn, msg: str = ""
):
    before = _sample(sample_name, labels)
    fn()
    after = _sample(sample_name, labels)
    assert pytest.approx(after - before) == expected, msg


def _make_llm_success(usage=None, model: str = "gpt-4o-mini"):
    body = {"choices": [{"message": {"content": "test content"}}]}
    if usage is not None:
        body["usage"] = usage
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = body

    mock_client_instance = MagicMock()
    mock_client_instance.post.return_value = mock_response

    def _invoke():
        with patch.object(providers.settings, "openai_api_key", "test-key"), \
                patch.object(providers.settings, "ai_deterministic_mode", False), \
                patch.object(providers.settings, "llm_timeout_seconds", 30), \
                patch("httpx.Client") as MockClient:
            MockClient.return_value.__enter__ = MagicMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__exit__ = MagicMock(return_value=False)
            return OpenAIProvider().llm_chat("sys", "usr", model=model)

    return _invoke


class TestTokenCapture:
    def test_llm_response_captures_reported_usage(self):
        call = _make_llm_success(
            usage={"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
        )
        resp = call()
        assert resp.prompt_tokens == 11
        assert resp.completion_tokens == 7
        assert resp.total_tokens == 18

    def test_missing_usage_leaves_token_fields_none(self):
        call = _make_llm_success(usage=None)
        resp = call()
        assert resp.prompt_tokens is None
        assert resp.completion_tokens is None
        assert resp.total_tokens is None

    def test_non_numeric_usage_is_ignored(self):
        call = _make_llm_success(usage={"prompt_tokens": "many"})
        resp = call()
        assert resp.prompt_tokens is None


class TestUsageMetrics:
    def test_tokens_and_cost_recorded_with_labels(self):
        labels = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "endpoint": "humanitarian_verification",
        }

        def counters():
            return (
                _sample("ai_token_usage_total", {**labels, "token_type": "prompt"}),
                _sample(
                    "ai_token_usage_total", {**labels, "token_type": "completion"}
                ),
                _sample("ai_token_cost_estimated_usd_total", labels),
            )

        def request():
            with usage_endpoint("humanitarian_verification"):
                with patch.object(
                    providers.settings,
                    "token_cost_rates",
                    {"gpt-4o-mini": {"prompt": 1.0, "completion": 2.0}},
                ):
                    _make_llm_success(
                        usage={
                            "prompt_tokens": 1000,
                            "completion_tokens": 500,
                            "total_tokens": 1500,
                        }
                    )()

        before = counters()
        request()
        after = counters()

        assert after[0] - before[0] == 1000, "prompt tokens should be recorded"
        assert after[1] - before[1] == 500, "completion tokens should be recorded"
        assert pytest.approx(after[2] - before[2]) == (
            1.0 * 1.0 + 0.5 * 2.0
        ), "cost should use the configured per-model rates"

    def test_missing_usage_counted_separately_not_zero(self):
        labels = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "endpoint": "unattributed",
        }
        token_labels = {**labels, "token_type": "prompt"}

        call = _make_llm_success(usage=None)

        _assert_delta(
            "ai_token_usage_unavailable_total",
            labels,
            1,
            call,
            "requests without reported usage must be counted separately",
        )
        _assert_delta(
            "ai_token_usage_total",
            token_labels,
            0,
            lambda: None,
            "missing usage must never be folded into zero-token counts",
        )

    def test_deterministic_mode_counts_unavailable(self):
        labels = {
            "provider": "openai",
            "model": "other",
            "endpoint": "unattributed",
        }

        def request():
            with patch.object(providers.settings, "openai_api_key", "test-key"), \
                    patch.object(
                        providers.settings, "ai_deterministic_mode", True
                    ):
                OpenAIProvider().llm_chat("sys", "usr", model="some-custom-model")

        _assert_delta(
            "ai_token_usage_unavailable_total",
            labels,
            1,
            request,
            "deterministic mode reports no usage",
        )


class TestCostRates:
    def test_estimate_uses_configured_model_rates(self):
        rates = {"model-a": {"prompt": 3.0, "completion": 5.0}}
        with patch.object(providers.settings, "token_cost_rates", rates):
            cost = estimate_token_cost_usd("model-a", 2000, 1000)
        assert pytest.approx(cost) == 2 * 3.0 + 1 * 5.0

    def test_unknown_model_falls_back_to_defaults(self):
        rates = {}
        defaults = (
            providers.settings.token_cost_default_prompt_rate,
            providers.settings.token_cost_default_completion_rate,
        )
        with patch.object(providers.settings, "token_cost_rates", rates), \
                patch.object(
                    providers.settings, "token_cost_default_prompt_rate", 2.0
                ), \
                patch.object(
                    providers.settings,
                    "token_cost_default_completion_rate",
                    4.0,
                ):
            cost = estimate_token_cost_usd("never-seen-model", 1000, 1000)
        assert pytest.approx(cost) == 1 * 2.0 + 1 * 4.0

    def test_negative_rates_are_clamped(self):
        rates = {"bad-model": {"prompt": -1.0, "completion": -2.0}}
        with patch.object(providers.settings, "token_cost_rates", rates):
            assert estimate_token_cost_usd("bad-model", 1000, 1000) == 0.0


class TestLabelCardinality:
    def test_unknown_model_buckets_into_other(self):
        labels = {
            "provider": "openai",
            "model": "other",
            "endpoint": "unattributed",
        }
        call = _make_llm_success(
            usage={"prompt_tokens": 5, "completion_tokens": 5},
            model="totally-custom-model",
        )

        def request():
            with patch.object(providers.settings, "token_cost_rates", {}):
                call()

        _assert_delta(
            "ai_token_usage_total",
            {**labels, "token_type": "prompt"},
            5,
            request,
            "unlisted models must normalize to the bounded 'other' label",
        )

    def test_unknown_endpoint_buckets_into_other(self):
        labels = {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "endpoint": "other",
        }
        response = LLMResponse(
            content="ok",
            provider="groq",
            model="llama-3.3-70b-versatile",
            prompt_tokens=3,
            completion_tokens=3,
        )

        def request():
            with usage_endpoint("rogue-endpoint-name"):
                record_llm_token_usage(response)

        _assert_delta(
            "ai_token_usage_total",
            {**labels, "token_type": "prompt"},
            3,
            request,
            "endpoints outside the allowlist must normalize to 'other'",
        )

    def test_builtin_models_keep_their_label(self):
        assert (
            providers._normalize_model_label("llama-3.3-70b-versatile")
            == "llama-3.3-70b-versatile"
        )


class TestEndpointAttribution:
    def test_context_manager_scopes_endpoint(self):
        with usage_endpoint("humanitarian_verification"):
            assert providers.current_usage_endpoint() == "humanitarian_verification"
        assert providers.current_usage_endpoint() == "unattributed"

    def test_exception_resets_endpoint(self):
        with pytest.raises(RuntimeError):
            with usage_endpoint("humanitarian_verification"):
                raise RuntimeError("boom")
        assert providers.current_usage_endpoint() == "unattributed"

    def test_humanitarian_service_attributes_usage_to_endpoint(self):
        from PIL import Image  # noqa: F401  (ensures stub consistent with conftest)

        from services.humanitarian_verification import HumanitarianVerificationService

        labels = {
            "provider": "test",
            "model": "test-provider/fixture",
            "endpoint": "humanitarian_verification",
        }

        def request():
            with patch.object(providers.settings, "test_provider_mode", True):
                service = HumanitarianVerificationService()
                result = service.verify_claim("claim text")
                assert result["provider"] == "test"

        _assert_delta(
            "ai_token_usage_unavailable_total",
            labels,
            1,
            request,
            "service dispatch should be attributed to the humanitarian endpoint",
        )
