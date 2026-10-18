"""Windowed provider spend tracking for automatic cost-ceiling routing."""

import time
from typing import Any, Dict, Optional

from config import settings

_WINDOW_SECONDS = {"hourly": 3600, "daily": 86400}


class ProviderCostCeiling:
    """Tracks estimated provider spend in shared, expiring Redis buckets."""

    def __init__(self, redis_client: Optional[Any] = None, clock=time.time):
        self.redis_client = redis_client
        self.clock = clock
        self._local_spend: Dict[str, float] = {}

    def set_redis_client(self, redis_client: Any) -> None:
        self.redis_client = redis_client

    def _bucket(self, provider: str) -> Optional[tuple[str, str, float, int]]:
        config = settings.llm_provider_cost_ceilings.get(provider)
        if not config:
            return None
        window = config["window"]
        seconds = _WINDOW_SECONDS[window]
        bucket_number = int(self.clock()) // seconds
        key = f"ai:provider-cost:{provider}:{window}:{bucket_number}"
        return key, window, float(config["limit_usd"]), (bucket_number + 1) * seconds

    def current_spend(self, provider: str) -> float:
        bucket = self._bucket(provider)
        if bucket is None:
            return 0.0
        key, _, _, _ = bucket
        if self.redis_client is not None:
            value = self.redis_client.get(key)
            spend = float(value or 0.0)
        else:
            spend = self._local_spend.get(key, 0.0)
        self._publish(provider, bucket[1], bucket[2], spend)
        return spend

    def is_exceeded(self, provider: str) -> bool:
        bucket = self._bucket(provider)
        if bucket is None:
            return False
        return self.current_spend(provider) >= bucket[2]

    def record_spend(self, provider: str, cost_usd: float) -> None:
        bucket = self._bucket(provider)
        if bucket is None or cost_usd <= 0:
            return
        key, window, limit_usd, expires_at = bucket
        if self.redis_client is not None:
            spend = float(self.redis_client.incrbyfloat(key, cost_usd))
            self.redis_client.expireat(key, expires_at)
        else:
            spend = self._local_spend.get(key, 0.0) + cost_usd
            self._local_spend[key] = spend
        self._publish(provider, window, limit_usd, spend)

    def snapshot(self) -> Dict[str, Dict[str, Any]]:
        result: Dict[str, Dict[str, Any]] = {}
        for provider, config in settings.llm_provider_cost_ceilings.items():
            result[provider] = {
                "window": config["window"],
                "ceiling_usd": float(config["limit_usd"]),
                "current_spend_usd": self.current_spend(provider),
            }
        return result

    @staticmethod
    def _publish(provider: str, window: str, limit_usd: float, spend: float) -> None:
        import metrics

        metrics.LLM_PROVIDER_COST_CEILING_USD.labels(
            provider=provider, window=window
        ).set(limit_usd)
        metrics.LLM_PROVIDER_CURRENT_SPEND_USD.labels(
            provider=provider, window=window
        ).set(spend)
