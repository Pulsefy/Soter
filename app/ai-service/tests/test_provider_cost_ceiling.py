from config import settings
from services.provider_cost_ceiling import ProviderCostCeiling
import metrics


def test_hourly_spend_resets_at_next_window(monkeypatch):
    monkeypatch.setattr(
        settings,
        "llm_provider_cost_ceilings",
        {"openai": {"limit_usd": 1.0, "window": "hourly"}},
    )
    now = [3600 * 12 + 10]
    tracker = ProviderCostCeiling(clock=lambda: now[0])

    tracker.record_spend("openai", 0.75)
    assert tracker.current_spend("openai") == 0.75
    assert tracker.is_exceeded("openai") is False

    now[0] += 3600
    assert tracker.current_spend("openai") == 0.0
    assert tracker.is_exceeded("openai") is False


def test_daily_spend_resets_at_next_utc_day(monkeypatch):
    monkeypatch.setattr(
        settings,
        "llm_provider_cost_ceilings",
        {"groq": {"limit_usd": 0.5, "window": "daily"}},
    )
    now = [86400 * 4 + 100]
    tracker = ProviderCostCeiling(clock=lambda: now[0])

    tracker.record_spend("groq", 0.5)
    assert tracker.is_exceeded("groq") is True

    now[0] += 86400
    assert tracker.is_exceeded("groq") is False


def test_snapshot_exposes_ceiling_and_current_spend(monkeypatch):
    monkeypatch.setattr(
        settings,
        "llm_provider_cost_ceilings",
        {"openai": {"limit_usd": 2.0, "window": "daily"}},
    )
    tracker = ProviderCostCeiling(clock=lambda: 123)
    tracker.record_spend("openai", 0.4)

    assert tracker.snapshot() == {
        "openai": {
            "window": "daily",
            "ceiling_usd": 2.0,
            "current_spend_usd": 0.4,
        }
    }
    ceiling_samples = metrics.LLM_PROVIDER_COST_CEILING_USD.collect()[0].samples
    spend_samples = metrics.LLM_PROVIDER_CURRENT_SPEND_USD.collect()[0].samples
    assert any(
        sample.labels == {"provider": "openai", "window": "daily"}
        and sample.value == 2.0
        for sample in ceiling_samples
    )
    assert any(
        sample.labels == {"provider": "openai", "window": "daily"}
        and sample.value == 0.4
        for sample in spend_samples
    )
