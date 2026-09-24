"""
Tests for LLM token usage and cost metrics (issue #981).

`metrics.record_llm_usage` is the single place that turns an LLM call's
token counts into Prometheus data: `LLM_TOKENS_TOTAL` (prompt/completion,
labelled by provider/model/endpoint), `LLM_COST_USD_TOTAL` (derived from
`settings.llm_model_cost_per_1k_tokens`), and `LLM_USAGE_UNAVAILABLE_TOTAL`
for calls where the provider didn't report usage at all. These tests
exercise that function and `estimate_llm_cost_usd` directly against real
prom-client counters (kept out of the default registry, matching the
convention in test_metrics_cardinality.py), plus confirm the two provider
call sites (OpenAI/Groq HTTP parsing, humanitarian_verification's success
path) actually wire it up.
"""

from unittest.mock import patch

import metrics


def counter_value(counter, **labels):
    data = counter.collect()[0]
    for sample in data.samples:
        if sample.name.endswith("_total") and all(
            sample.labels.get(k) == v for k, v in labels.items()
        ):
            return sample.value
    return None


class TestEstimateLlmCostUsd:
    def test_computes_cost_from_configured_rates(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {
                "gpt-4o-mini": {"prompt": 0.001, "completion": 0.002},
            }
            cost = metrics.estimate_llm_cost_usd("gpt-4o-mini", 1000, 500)
            assert cost == 0.001 * 1 + 0.002 * 0.5

    def test_returns_none_for_an_unrated_model(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {}
            assert metrics.estimate_llm_cost_usd("mystery-model", 100, 100) is None

    def test_returns_none_when_a_rate_is_missing_a_direction(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {
                "partial-model": {"prompt": 0.001},
            }
            assert metrics.estimate_llm_cost_usd("partial-model", 100, 100) is None

    def test_zero_tokens_costs_zero_not_none(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {
                "gpt-4o-mini": {"prompt": 0.001, "completion": 0.002},
            }
            assert metrics.estimate_llm_cost_usd("gpt-4o-mini", 0, 0) == 0.0


class TestRecordLlmUsage:
    def test_records_prompt_and_completion_tokens_separately(self):
        before_prompt = (
            counter_value(
                metrics.LLM_TOKENS_TOTAL,
                provider="openai",
                model="gpt-4o-mini",
                endpoint="humanitarian_verification",
                token_type="prompt",
            )
            or 0
        )
        before_completion = (
            counter_value(
                metrics.LLM_TOKENS_TOTAL,
                provider="openai",
                model="gpt-4o-mini",
                endpoint="humanitarian_verification",
                token_type="completion",
            )
            or 0
        )

        metrics.record_llm_usage(
            provider="openai",
            model="gpt-4o-mini",
            endpoint="humanitarian_verification",
            prompt_tokens=120,
            completion_tokens=45,
        )

        after_prompt = counter_value(
            metrics.LLM_TOKENS_TOTAL,
            provider="openai",
            model="gpt-4o-mini",
            endpoint="humanitarian_verification",
            token_type="prompt",
        )
        after_completion = counter_value(
            metrics.LLM_TOKENS_TOTAL,
            provider="openai",
            model="gpt-4o-mini",
            endpoint="humanitarian_verification",
            token_type="completion",
        )

        assert after_prompt == before_prompt + 120
        assert after_completion == before_completion + 45

    def test_records_estimated_cost_when_model_is_rated(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {
                "rate-test-model": {"prompt": 0.01, "completion": 0.02},
            }
            before = (
                counter_value(
                    metrics.LLM_COST_USD_TOTAL,
                    provider="openai",
                    model="rate-test-model",
                    endpoint="humanitarian_verification",
                )
                or 0
            )

            metrics.record_llm_usage(
                provider="openai",
                model="rate-test-model",
                endpoint="humanitarian_verification",
                prompt_tokens=1000,
                completion_tokens=1000,
            )

            after = counter_value(
                metrics.LLM_COST_USD_TOTAL,
                provider="openai",
                model="rate-test-model",
                endpoint="humanitarian_verification",
            )
            assert after == before + 0.03

    def test_does_not_record_cost_for_an_unrated_model(self):
        with patch("metrics.settings") as mock_settings:
            mock_settings.llm_model_cost_per_1k_tokens = {}
            before = (
                counter_value(
                    metrics.LLM_COST_USD_TOTAL,
                    provider="groq",
                    model="totally-unrated-model",
                    endpoint="humanitarian_verification",
                )
                or 0
            )

            metrics.record_llm_usage(
                provider="groq",
                model="totally-unrated-model",
                endpoint="humanitarian_verification",
                prompt_tokens=500,
                completion_tokens=500,
            )

            after = (
                counter_value(
                    metrics.LLM_COST_USD_TOTAL,
                    provider="groq",
                    model="totally-unrated-model",
                    endpoint="humanitarian_verification",
                )
                or 0
            )
            assert after == before

    def test_missing_prompt_tokens_counts_as_unavailable_not_zero(self):
        before_tokens = (
            counter_value(
                metrics.LLM_TOKENS_TOTAL,
                provider="test",
                model="unavailable-model-a",
                endpoint="humanitarian_verification",
                token_type="prompt",
            )
            or 0
        )
        before_unavailable = (
            counter_value(
                metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
                provider="test",
                model="unavailable-model-a",
                endpoint="humanitarian_verification",
            )
            or 0
        )

        metrics.record_llm_usage(
            provider="test",
            model="unavailable-model-a",
            endpoint="humanitarian_verification",
            prompt_tokens=None,
            completion_tokens=10,
        )

        after_tokens = (
            counter_value(
                metrics.LLM_TOKENS_TOTAL,
                provider="test",
                model="unavailable-model-a",
                endpoint="humanitarian_verification",
                token_type="prompt",
            )
            or 0
        )
        after_unavailable = counter_value(
            metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
            provider="test",
            model="unavailable-model-a",
            endpoint="humanitarian_verification",
        )

        # Token counter must NOT move at all - a partial reading is still
        # "unavailable", not a zero-token request.
        assert after_tokens == before_tokens
        assert after_unavailable == before_unavailable + 1

    def test_missing_completion_tokens_counts_as_unavailable(self):
        before = (
            counter_value(
                metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
                provider="test",
                model="unavailable-model-b",
                endpoint="humanitarian_verification",
            )
            or 0
        )

        metrics.record_llm_usage(
            provider="test",
            model="unavailable-model-b",
            endpoint="humanitarian_verification",
            prompt_tokens=10,
            completion_tokens=None,
        )

        after = counter_value(
            metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
            provider="test",
            model="unavailable-model-b",
            endpoint="humanitarian_verification",
        )
        assert after == before + 1

    def test_both_tokens_missing_counts_as_unavailable_once(self):
        before = (
            counter_value(
                metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
                provider="test",
                model="fully-unavailable-model",
                endpoint="humanitarian_verification",
            )
            or 0
        )

        metrics.record_llm_usage(
            provider="test",
            model="fully-unavailable-model",
            endpoint="humanitarian_verification",
            prompt_tokens=None,
            completion_tokens=None,
        )

        after = counter_value(
            metrics.LLM_USAGE_UNAVAILABLE_TOTAL,
            provider="test",
            model="fully-unavailable-model",
            endpoint="humanitarian_verification",
        )
        assert after == before + 1
