"""Synthetic canary health checks for AI provider circuit breakers.

A scheduled asyncio task probes each configured LLM provider with a minimal,
low-cost request on a fixed interval. A canary failure is fed directly into
the provider's circuit breaker (via ``record_failure`` / ``record_success``)
so degradation is detected *before* real user traffic is affected.

Design decisions
----------------
* **Minimal prompt** — the canary uses a tiny, fixed user prompt
  (``CANARY_PROMPT``) that costs < 10 tokens on any model. Operators can
  override the prompt text via ``CANARY_PROMPT`` in settings without changing
  code.
* **Circuit-breaker integration** — canary failures count toward the failure
  threshold exactly like real request failures. The circuit breaker doesn't
  distinguish the source; it just counts. This is intentional: a canary
  failure means "this provider is unhealthy" regardless of why.
* **Log distinguishability** — every canary log record carries ``canary=true``
  in its structured fields and ``[canary]`` in the message so log queries and
  cost-tracking dashboards can filter by it.
* **asyncio scheduler** — the service is started with ``asyncio.create_task``
  inside the app lifespan, matching the existing pattern for other background
  work in the service (drain loop, etc.).  APScheduler and Celery are
  intentionally avoided to keep the dependency surface small.
* **Graceful shutdown** — the loop is cancelled on lifespan exit; any
  in-flight canary request is allowed to finish (it runs in a thread executor
  because the provider call is synchronous).
* **Per-provider disable** — set ``CANARY_DISABLED_PROVIDERS=openai,groq``
  to skip individual providers without touching the circuit breaker or
  disabling canary globally.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import List, Optional, Set

from config import settings
from services.circuit_breaker import CircuitBreaker, CircuitBreakerRegistry
from services.providers import ProviderRegistry

logger = logging.getLogger(__name__)

#: Structured log field that marks every canary-related log record.
_CANARY_MARKER = {"canary": True}

#: System prompt for canary requests — as short as possible to keep token cost
#: near zero while still exercising the provider's full request/response path.
_CANARY_SYSTEM_PROMPT = (
    "You are a health-check agent. Reply with the exact word requested and nothing else."
)


def _get_or_create_breaker(provider_name: str) -> CircuitBreaker:
    """Return the existing circuit breaker for *provider_name*, creating one
    with default settings if it has not been registered yet.

    The breaker is always registered in :class:`CircuitBreakerRegistry` on
    creation, so the admin endpoint picks it up automatically.
    """
    breaker = CircuitBreakerRegistry.get(provider_name)
    if breaker is None:
        breaker = CircuitBreaker(
            name=provider_name,
            failure_threshold=settings.circuit_breaker_failure_threshold,
            recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
        )
    return breaker


def _probe_provider(provider_name: str, prompt: str) -> None:
    """Execute a single synchronous canary probe against *provider_name*.

    Records success or failure on the provider's circuit breaker and emits
    a prometheus metric increment.  All log records carry ``canary=true``
    so they are distinguishable from real-traffic logs.

    This function is intentionally synchronous (matching the provider interface)
    and is expected to be called via ``asyncio.get_event_loop().run_in_executor``
    so the event loop is not blocked.
    """
    # Import here to avoid a circular import at module level
    import metrics  # noqa: PLC0415

    registry = ProviderRegistry()
    breaker = _get_or_create_breaker(provider_name)

    # If the circuit is OPEN we still run the canary — unlike real requests we
    # do not skip a closed breaker. The canary is the health probe that decides
    # whether the provider is worth trying again; it should run unconditionally
    # so the breaker gets recovery signal as soon as the provider heals.
    start = time.monotonic()
    try:
        provider = registry.get(provider_name)
        response = provider.llm_chat(
            system_prompt=_CANARY_SYSTEM_PROMPT,
            user_prompt=prompt,
        )
        latency = time.monotonic() - start
        metrics.CANARY_LATENCY.labels(provider=provider_name).observe(latency)
        metrics.CANARY_CHECKS_TOTAL.labels(provider=provider_name, outcome="success").inc()
        breaker.record_success()
        logger.info(
            "[canary] probe succeeded provider=%s latency_ms=%d model=%s",
            provider_name,
            int(latency * 1000),
            response.model,
            extra={**_CANARY_MARKER, "provider": provider_name, "latency_ms": int(latency * 1000)},
        )
    except Exception as exc:  # noqa: BLE001 — canary must never crash the scheduler
        latency = time.monotonic() - start
        metrics.CANARY_LATENCY.labels(provider=provider_name).observe(latency)
        metrics.CANARY_CHECKS_TOTAL.labels(provider=provider_name, outcome="failure").inc()
        breaker.record_failure()
        logger.warning(
            "[canary] probe failed provider=%s latency_ms=%d error=%s",
            provider_name,
            int(latency * 1000),
            exc,
            extra={
                **_CANARY_MARKER,
                "provider": provider_name,
                "latency_ms": int(latency * 1000),
                "error": str(exc),
            },
        )


class CanaryService:
    """Periodically probes each configured LLM provider with a minimal request.

    Lifecycle
    ---------
    Call ``start()`` once from the app lifespan to launch the background loop,
    and ``stop()`` to request cancellation and await completion::

        canary = CanaryService()
        task = canary.start()
        ...
        await canary.stop()

    The service reads its configuration from ``settings`` on each tick, so
    changes to ``CANARY_DISABLED_PROVIDERS`` or ``CANARY_INTERVAL_SECONDS``
    take effect on the next wake-up without a restart.
    """

    def __init__(
        self,
        interval_seconds: Optional[float] = None,
        disabled_providers: Optional[Set[str]] = None,
        prompt: Optional[str] = None,
    ) -> None:
        # Allow explicit overrides for tests; fall back to live settings.
        self._interval: Optional[float] = interval_seconds
        self._disabled: Optional[Set[str]] = disabled_providers
        self._prompt: Optional[str] = prompt
        self._task: Optional[asyncio.Task] = None  # type: ignore[type-arg]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self) -> "asyncio.Task[None]":
        """Launch the canary loop as a background asyncio task.

        The returned task is also stored as ``self._task`` for use by
        :meth:`stop`.
        """
        if self._task is not None and not self._task.done():
            raise RuntimeError("CanaryService is already running")
        self._task = asyncio.create_task(self._loop(), name="canary_scheduler")
        logger.info(
            "[canary] scheduler started interval_seconds=%s",
            self._effective_interval(),
            extra=_CANARY_MARKER,
        )
        return self._task

    async def stop(self) -> None:
        """Cancel the canary loop and wait for it to finish."""
        if self._task is None or self._task.done():
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        logger.info("[canary] scheduler stopped", extra=_CANARY_MARKER)

    # ------------------------------------------------------------------
    # Internal loop
    # ------------------------------------------------------------------

    async def _loop(self) -> None:
        """Run canary probes forever, sleeping between rounds."""
        while True:
            interval = self._effective_interval()
            await asyncio.sleep(interval)
            await self._run_round()

    async def _run_round(self) -> None:
        """Probe every active, non-disabled provider once."""
        if not settings.canary_enabled and self._disabled is None:
            # Global kill-switch respected on each tick.
            return

        providers = self._active_providers()
        if not providers:
            logger.debug("[canary] no active providers to probe", extra=_CANARY_MARKER)
            return

        loop = asyncio.get_event_loop()
        prompt = self._effective_prompt()
        # Fan out all probes concurrently; each runs in a thread executor
        # because provider.llm_chat() is synchronous (httpx + blocking I/O).
        tasks = [
            loop.run_in_executor(None, _probe_provider, name, prompt)
            for name in providers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Executor errors are already caught inside _probe_provider; anything
        # that leaks here (e.g. executor shutdown) is logged and not re-raised.
        for provider_name, result in zip(providers, results):
            if isinstance(result, Exception):
                logger.error(
                    "[canary] unexpected error in executor provider=%s error=%s",
                    provider_name,
                    result,
                    extra={**_CANARY_MARKER, "provider": provider_name},
                )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _effective_interval(self) -> float:
        return self._interval if self._interval is not None else settings.canary_interval_seconds

    def _effective_prompt(self) -> str:
        return self._prompt if self._prompt is not None else settings.canary_prompt

    def _active_providers(self) -> List[str]:
        """Return LLM providers to probe this tick.

        A provider is included when:
        * It appears in the available LLM provider list (has a configured API key
          or test-provider mode is on).
        * It is not in the disabled set (``CANARY_DISABLED_PROVIDERS`` or the
          constructor override).
        """
        disabled = (
            self._disabled
            if self._disabled is not None
            else set(settings.get_canary_disabled_providers())
        )
        registry = ProviderRegistry()
        available = registry.available_llm_providers()
        result: List[str] = []
        for name in available:
            if name in disabled:
                import metrics  # noqa: PLC0415
                metrics.CANARY_CHECKS_TOTAL.labels(provider=name, outcome="skipped").inc()
                logger.debug(
                    "[canary] skipping disabled provider provider=%s",
                    name,
                    extra={**_CANARY_MARKER, "provider": name},
                )
            else:
                result.append(name)
        return result


# ---------------------------------------------------------------------------
# Process-wide singleton
# ---------------------------------------------------------------------------

_canary: Optional[CanaryService] = None


def get_canary() -> CanaryService:
    """Return the process-wide CanaryService instance, creating it if needed."""
    global _canary
    if _canary is None:
        _canary = CanaryService()
    return _canary


def set_canary(canary: Optional[CanaryService]) -> None:
    """Override the process-wide instance (used by tests)."""
    global _canary
    _canary = canary
