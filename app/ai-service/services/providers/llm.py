"""LLM provider implementations and :class:`LLMProviderRegistry`.

This module ships three reference implementations that conform to the
``LLMProvider`` contract::

* :class:`OpenAIProvider` - talks to the OpenAI Chat Completions API.
* :class:`GroqProvider` - talks to the Groq Chat Completions API (which
  is wire-compatible with the OpenAI format).
* :class:`FixtureLLMProvider` - returns deterministic JSON sourced from
  ``fixtures/humanitarian_responses.json``.  Useful for staging,
  testnet, and CI runs where no API keys are available.

Adding a new provider is a matter of writing a subclass of
:class:`services.providers.base.LLMProvider` and registering its factory
with an :class:`LLMProviderRegistry`.  No route code or verification
service logic needs to change.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Optional

from config import Settings, settings as default_settings
from services.providers.base import (
    LLMProvider,
    LLMRequest,
    LLMResponse,
    ProviderConfigurationError,
    ProviderConnectionError,
    ProviderResponseError,
    ProviderTimeoutError,
)
from services.test_provider import TestProvider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# OpenAI-compatible chat completion helpers
# ---------------------------------------------------------------------------


def _call_chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    request: LLMRequest,
    timeout_seconds: int,
    deterministic_response: Optional[str] = None,
) -> str:
    """Shared helper for OpenAI-compatible Chat Completions APIs (OpenAI + Groq).

    Centralising the implementation lets us keep a single, well-tested
    HTTP transport while still having two distinct provider classes for
    configuration and routing purposes.
    """
    import httpx  # imported lazily so the module loads without httpx in tests

    if request.deterministic and deterministic_response is not None:
        logger.info(
            "Deterministic AI mode enabled: returning stable response (provider=%s)",
            base_url,
        )
        return deterministic_response

    payload: Dict[str, Any] = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    request_timeout = (
        float(request.timeout)
        if request.timeout is not None
        else float(timeout_seconds)
    )

    provider_label = "openai" if "openai" in base_url else "groq"

    try:
        with httpx.Client(timeout=request_timeout) as client:
            response = client.post(base_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException as exc:
        raise ProviderTimeoutError(
            f"LLM request timed out after {request_timeout}s",
            provider=provider_label,
            details={"timeout_seconds": request_timeout},
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise ProviderConnectionError(
            f"LLM request failed with status {exc.response.status_code}",
            provider=provider_label,
            details={"status_code": exc.response.status_code},
        ) from exc
    except Exception as exc:  # network or JSON decode errors
        raise ProviderConnectionError(
            f"LLM connection error: {exc}",
            provider=provider_label,
        ) from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderResponseError(
            f"Unexpected LLM response format: {data}",
            provider=provider_label,
        ) from exc

    if not content:
        raise ProviderResponseError(
            "LLM returned empty content",
            provider=provider_label,
        )

    return str(content)


# ---------------------------------------------------------------------------
# Concrete implementations
# ---------------------------------------------------------------------------


class OpenAIProvider(LLMProvider):
    """OpenAI Chat Completions backend.

    Uses the shared :func:`_call_chat_completion` helper under the hood
    so that future tweaks to the OpenAI wire format are applied to both
    OpenAI and Groq in one place.
    """

    BASE_URL = "https://api.openai.com/v1/chat/completions"

    def __init__(
        self,
        model: str,
        api_key: Optional[str],
        timeout_seconds: int = 30,
        deterministic_response: Optional[str] = None,
    ) -> None:
        self.name = "openai"
        self.model = model
        self._api_key = api_key
        self._timeout_seconds = int(timeout_seconds)
        self._deterministic_response = deterministic_response

    def healthy(self) -> bool:
        """Healthy iff an API key is configured."""
        return bool(self._api_key)

    def generate(self, request: LLMRequest) -> LLMResponse:
        if not self._api_key:
            raise ProviderConfigurationError(
                "OpenAI API key is not configured",
                provider=self.name,
            )
        content = _call_chat_completion(
            base_url=self.BASE_URL,
            api_key=self._api_key,
            model=self.model,
            request=request,
            timeout_seconds=self._timeout_seconds,
            deterministic_response=self._deterministic_response,
        )
        return LLMResponse(content=content, provider_name=self.name, model=self.model)


class GroqProvider(LLMProvider):
    """Groq Chat Completions backend.

    Groq exposes an OpenAI-compatible chat completions API; we keep the
    provider class separate from :class:`OpenAIProvider` so that callers
    see distinct names in logs/metrics and so the URLs are configured
    independently.
    """

    BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(
        self,
        model: str,
        api_key: Optional[str],
        timeout_seconds: int = 30,
        deterministic_response: Optional[str] = None,
    ) -> None:
        self.name = "groq"
        self.model = model
        self._api_key = api_key
        self._timeout_seconds = int(timeout_seconds)
        self._deterministic_response = deterministic_response

    def healthy(self) -> bool:
        """Healthy iff an API key is configured."""
        return bool(self._api_key)

    def generate(self, request: LLMRequest) -> LLMResponse:
        if not self._api_key:
            raise ProviderConfigurationError(
                "Groq API key is not configured",
                provider=self.name,
            )
        content = _call_chat_completion(
            base_url=self.BASE_URL,
            api_key=self._api_key,
            model=self.model,
            request=request,
            timeout_seconds=self._timeout_seconds,
            deterministic_response=self._deterministic_response,
        )
        return LLMResponse(content=content, provider_name=self.name, model=self.model)


class FixtureLLMProvider(LLMProvider):
    """Deterministic LLM provider that loads fixture-based responses.

    Internally delegates JSON loading to :class:`services.test_provider.TestProvider`
    so that fixture files live in a single place.  This provider requires
    no API keys, making it the safest default for staging, testnet, and
    CI environments.
    """

    FIXTURE_ENDPOINT = "humanitarian"
    DEFAULT_MODEL = "test-provider/fixture"

    def __init__(self, test_provider: Optional[TestProvider] = None) -> None:
        self.name = "test"
        self.model = self.DEFAULT_MODEL
        self._test_provider = test_provider or TestProvider()

    def generate(self, request: LLMRequest) -> LLMResponse:
        fixture = self._test_provider.get_response(
            self.FIXTURE_ENDPOINT,
            {
                "system_prompt": request.system_prompt,
                "user_prompt": request.user_prompt,
                **request.metadata,
            },
        )
        content = json.dumps(fixture, separators=(",", ":"), sort_keys=True)
        return LLMResponse(
            content=content,
            provider_name=self.name,
            model=self.model,
            raw=fixture,
        )

    def healthy(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


Factory = Callable[[Settings], LLMProvider]


class LLMProviderRegistry:
    """Resolve :class:`LLMProvider` instances by name.

    The registry is the single source of truth for *which* providers are
    configured and *in what order* a verification service should try
    them.  Routes and verification services call ``get_attempt_order``
    and forget about which concrete backend is configured - that's the
    abstraction's whole point.

    Typical usage::

        registry = build_default_llm_registry()
        for provider in registry.get_attempt_order(preference="auto"):
            response = provider.generate(LLMRequest(...))
            ...

    The registry caches instantiated providers so that callers can take
    stable references (e.g. as circuit-breaker keys) without paying the
    construction cost on every request.
    """

    def __init__(self, settings_obj: Settings):
        self._settings = settings_obj
        self._factories: Dict[str, Factory] = {}
        self._instances: Dict[str, LLMProvider] = {}

    # --- registration --------------------------------------------------

    def register(self, name: str, factory: Factory) -> None:
        """Register a factory that builds a provider from :class:`Settings`."""
        self._factories[name] = factory
        # Any previously cached instance for this name is now stale.
        self._instances.pop(name, None)

    @property
    def settings(self) -> Settings:
        return self._settings

    # --- resolution ----------------------------------------------------

    def available(self) -> List[str]:
        """Return the names of providers that are usable for `auto` mode.

        Mirrors the historical ordering used by the pre-abstraction code:
        ``test`` first when test mode is enabled, then ``openai`` and/or
        ``groq`` based on the presence of their respective API keys.
        """
        names: List[str] = []
        if self._settings.test_provider_mode:
            names.append("test")
        if self._settings.openai_api_key:
            names.append("openai")
        if self._settings.groq_api_key:
            names.append("groq")
        return names

    def is_configured(self, name: str) -> bool:
        """Whether ``name`` is currently usable.

        This is distinct from "registered" - a registered provider may
        still be unusable (e.g. an OpenAI provider without an API key).
        """
        try:
            self.get(name)
        except ProviderConfigurationError:
            return False
        except Exception:  # pragma: no cover - defensive
            return False
        return True

    def get(self, name: str) -> LLMProvider:
        """Resolve a provider by registered name, caching the instance."""
        if name in self._instances:
            return self._instances[name]
        if name not in self._factories:
            raise ProviderConfigurationError(
                f"Unknown LLM provider: {name}",
                provider=name,
            )
        provider = self._factories[name](self._settings)
        # Eagerly validate configuration so callers get a clear error
        # the first time they call ``generate`` would fail anyway.
        if not provider.healthy():
            raise ProviderConfigurationError(
                f"LLM provider '{name}' is not healthy",
                provider=name,
            )
        self._instances[name] = provider
        return provider

    def get_attempt_order(self, preference: str) -> List[LLMProvider]:
        """Resolve the providers that should be tried, in order.

        ``preference`` matches the historical contract:
          * ``"auto"``     - all available providers, in documented order.
          * ``"test"``     - ``test`` first if available, then fallbacks.
          * explicit name  - that provider first, then other available
            providers as fallbacks.
        """
        pref = (preference or "auto").lower()
        available_names = self.available()

        if pref == "auto":
            order = available_names
        elif pref == "test":
            if "test" in available_names and self.is_configured("test"):
                order = ["test"]
            else:
                order = list(available_names)
        else:
            if pref in available_names and self.is_configured(pref):
                order = [pref] + [n for n in available_names if n != pref]
            else:
                # Fall back to the entire auto order so callers don't
                # silently drop requests when their preferred provider
                # is misconfigured.
                order = list(available_names)
        return [self.get(name) for name in order]


# ---------------------------------------------------------------------------
# Default registry factory
# ---------------------------------------------------------------------------


def build_default_llm_registry(
    settings_obj: Optional[Settings] = None,
) -> LLMProviderRegistry:
    """Build a registry wired up with the reference implementations.

    Adding a brand-new LLM provider only requires editing this function
    to add a new ``register`` call.  No route code changes are needed.
    """
    s = settings_obj or default_settings

    def _openai_factory(cfg: Settings) -> LLMProvider:
        return OpenAIProvider(
            model=cfg.openai_model,
            api_key=cfg.openai_api_key,
            timeout_seconds=cfg.llm_timeout_seconds,
        )

    def _groq_factory(cfg: Settings) -> LLMProvider:
        return GroqProvider(
            model=cfg.groq_model,
            api_key=cfg.groq_api_key,
            timeout_seconds=cfg.llm_timeout_seconds,
        )

    def _test_factory(cfg: Settings) -> LLMProvider:
        return FixtureLLMProvider()

    registry = LLMProviderRegistry(s)
    registry.register("openai", _openai_factory)
    registry.register("groq", _groq_factory)
    registry.register("test", _test_factory)
    return registry
