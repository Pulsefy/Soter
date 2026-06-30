"""Humanitarian claim verification service with provider abstraction.

The verification service no longer talks to OpenAI/Groq directly.  It
fetches providers from an :class:`LLMProviderRegistry` which can be
constructed once and shared across the application.  Routes only call
:meth:`HumanitarianVerificationService.verify_claim` and never need to
know which backend is configured - swapping providers is a registry
configuration change.

Circuit-breaker handling, prompt fallback and JSON parsing stay in
this module because they are part of the *verification policy*, not
of the provider contract.  Each provider is keyed by ``provider.name``
so the breaker state is stable across provider swaps.
"""

import json
import logging
import time
from typing import Any, Dict, List, Optional, Union

import metrics

from config import settings
from exceptions import AIServiceError
from services.circuit_breaker import CircuitBreaker
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.providers import (
    GroqProvider,
    LLMProvider,
    LLMProviderRegistry,
    LLMRequest,
    OpenAIProvider,
    ProviderConfigurationError,
    ProviderConnectionError,
    ProviderError,
    ProviderResponseError,
    ProviderTimeoutError,
    build_default_llm_registry,
)

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(
        self,
        llm_registry: Optional[LLMProviderRegistry] = None,
        breakers: Optional[Dict[str, CircuitBreaker]] = None,
    ):
        self.prompt_engine = HumanitarianPromptEngine()
        self.llm_registry = llm_registry or build_default_llm_registry()
        # Circuit breakers keyed by provider ``name`` so that swapping a
        # provider implementation does not silently reset the breaker
        # state.
        self.breakers: Dict[str, CircuitBreaker] = breakers or {
            "openai": CircuitBreaker(
                name="openai",
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            ),
            "groq": CircuitBreaker(
                name="groq",
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            ),
            "test": CircuitBreaker(
                name="test",
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            ),
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def verify_claim(
        self,
        aid_claim: str,
        supporting_evidence: Optional[List[str]] = None,
        context_factors: Optional[Dict[str, Any]] = None,
        provider_preference: str = "auto",
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        start_time = time.time()
        try:
            evidence = supporting_evidence or []
            context = context_factors or {}

            primary_prompt = self.prompt_engine.build_primary_prompt(
                aid_claim=aid_claim,
                supporting_evidence=evidence,
                context_factors=context,
            )
            fallback_prompt = self.prompt_engine.build_fallback_prompt(
                aid_claim=aid_claim,
                supporting_evidence=evidence,
                context_factors=context,
            )

            providers = self._provider_attempt_order(provider_preference)
            if not providers:
                raise RuntimeError(
                    "No LLM providers configured for humanitarian verification"
                )

            errors: List[str] = []

            for provider_entry in providers:
                provider_name = self._provider_name_of(provider_entry)
                breaker = self._breaker_for(provider_entry)
                if breaker and not breaker.allow_request():
                    logger.warning(
                        "Circuit breaker is OPEN for provider=%s. Skipping.",
                        provider_name,
                    )
                    errors.append(
                        f"provider={provider_name}, error=Circuit breaker is OPEN"
                    )
                    continue

                model = self._get_model_for_provider(provider_entry)

                for prompt_variant, prompt in (
                    ("primary", primary_prompt),
                    ("fallback", fallback_prompt),
                ):
                    try:
                        logger.info(
                            "Attempting humanitarian verification with provider=%s "
                            "model=%s prompt=%s",
                            provider_name,
                            model,
                            prompt_variant,
                        )
                        raw_content = self._call_provider(
                            provider=provider_entry,
                            model=model,
                            system_prompt=prompt["system"],
                            user_prompt=prompt["user"],
                            timeout=timeout,
                        )
                        parsed = self._parse_json_response(raw_content)
                        if breaker:
                            breaker.record_success()
                        return {
                            "provider": provider_name,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "verification": parsed,
                            "raw_response": raw_content,
                        }
                    except Exception as exc:
                        if breaker:
                            breaker.record_failure()
                        err = (
                            f"provider={provider_name}, model={model}, "
                            f"prompt={prompt_variant}, error={exc}"
                        )
                        errors.append(err)
                        logger.warning(
                            "Humanitarian verification attempt failed: %s", err
                        )

            raise RuntimeError(
                "All humanitarian verification attempts failed: "
                + " | ".join(errors)
            )
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name="verify").observe(
                latency
            )

    def all_providers_unavailable(self) -> bool:
        """Return True when every configured LLM provider circuit is open."""
        if settings.test_provider_mode:
            return False

        providers: List[str] = []
        if settings.openai_api_key:
            providers.append("openai")
        if settings.groq_api_key:
            providers.append("groq")
        if not providers:
            return False

        return all(
            provider in self.breakers
            and not self.breakers[provider].allow_request()
            for provider in providers
        )

    # ------------------------------------------------------------------
    # Internal helpers (kept stable for tests that monkeypatch them)
    # ------------------------------------------------------------------

    def _provider_attempt_order(
        self, provider_preference: str
    ) -> List[Union[str, LLMProvider]]:
        """Resolve providers to try, in order.

        Thin wrapper around the registry that raises the same
        ``RuntimeError`` the legacy implementation caused when no
        provider is configured.  Returns a mix of strings (legacy
        monkeypatches) and :class:`LLMProvider` instances (registry
        output); both shapes are accepted everywhere downstream.
        """
        try:
            providers = self.llm_registry.get_attempt_order(provider_preference)
        except ProviderConfigurationError as exc:
            raise RuntimeError(str(exc)) from exc
        return list(providers)

    def _get_model_for_provider(
        self, provider: Union[str, LLMProvider]
    ) -> str:
        """Resolve the model name for a provider entry.

        Accepts either a string (legacy monkeypatches) or an
        :class:`LLMProvider` instance (registry output).
        """
        if isinstance(provider, LLMProvider):
            return provider.model
        if provider == "test":
            return "test-provider/fixture"
        if provider == "openai":
            return settings.openai_model
        if provider == "groq":
            return settings.groq_model
        raise ValueError(f"Unsupported provider: {provider}")

    def _breaker_for(
        self, provider: Union[str, LLMProvider]
    ) -> Optional[CircuitBreaker]:
        return self.breakers.get(self._provider_name_of(provider))

    def _provider_name_of(self, provider: Union[str, LLMProvider]) -> str:
        if isinstance(provider, LLMProvider):
            return provider.name
        return str(provider)

    def _call_provider(
        self,
        provider: Union[str, LLMProvider],
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        """Dispatch a provider call through the LLMProvider abstraction.

        Accepts either a string (preserved for legacy test mocks) or
        an :class:`LLMProvider` instance (the new abstraction).  Both
        paths route through concrete provider classes so behaviour
        stays consistent and there is exactly one HTTP transport.
        """
        deterministic = bool(settings.ai_deterministic_mode)
        deterministic_response = (
            self._get_deterministic_response(model, system_prompt, user_prompt)
            if deterministic
            else None
        )

        if isinstance(provider, LLMProvider):
            request = LLMRequest(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                timeout=timeout,
                deterministic=deterministic,
                metadata={"provider_preference": provider.name},
            )
            try:
                response = provider.generate(request)
            except ProviderTimeoutError as exc:
                raise AIServiceError(
                    message=(
                        f"LLM request timed out after "
                        f"{exc.details.get('timeout_seconds')}s"
                    ),
                    code="AI_TIMEOUT",
                    details={
                        "provider": provider.name,
                        **(exc.details or {}),
                    },
                ) from exc
            except ProviderConnectionError as exc:
                raise AIServiceError(
                    message=f"LLM connection error: {exc.message}",
                    code="AI_CONNECTION_ERROR",
                    details={
                        "provider": provider.name,
                        **(exc.details or {}),
                    },
                ) from exc
            except ProviderResponseError as exc:
                raise AIServiceError(
                    message=f"LLM response error: {exc.message}",
                    code="AI_PROVIDER_ERROR",
                    details={
                        "provider": provider.name,
                        **(exc.details or {}),
                    },
                ) from exc
            except ProviderError as exc:
                raise AIServiceError(
                    message=f"LLM provider error: {exc.message}",
                    code="AI_PROVIDER_ERROR",
                    details={
                        "provider": provider.name,
                        **(exc.details or {}),
                    },
                ) from exc
            return str(response.content)

        # --- legacy string dispatch (preserved for existing tests) ---
        if provider == "test":
            return self._call_test(model, system_prompt, user_prompt)
        if provider == "openai":
            return self._call_openai(
                model, system_prompt, user_prompt, timeout, deterministic_response
            )
        if provider == "groq":
            return self._call_groq(
                model, system_prompt, user_prompt, timeout, deterministic_response
            )
        raise ValueError(f"Unsupported provider: {provider}")

    # ------------------------------------------------------------------
    # Legacy hooks retained so test mocks continue to operate
    # ------------------------------------------------------------------

    def _call_openai(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
        deterministic_response: Optional[str] = None,
    ) -> str:
        """Legacy hook: OpenAI calls route through :class:`OpenAIProvider`.

        Provider errors are converted to :class:`AIServiceError` with
        the same codes (``AI_TIMEOUT`` / ``AI_CONNECTION_ERROR`` /
        ``AI_PROVIDER_ERROR``) the original implementation emitted, so
        error-handler integration is unchanged.
        """
        provider = OpenAIProvider(
            model=model,
            api_key=settings.openai_api_key,
            timeout_seconds=settings.llm_timeout_seconds,
            deterministic_response=deterministic_response,
        )
        try:
            return str(
                provider.generate(
                    LLMRequest(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        timeout=timeout,
                        deterministic=bool(settings.ai_deterministic_mode),
                    )
                ).content
            )
        except ProviderTimeoutError as exc:
            raise AIServiceError(
                message=(
                    f"LLM request timed out after "
                    f"{exc.details.get('timeout_seconds')}s"
                ),
                code="AI_TIMEOUT",
                details={"provider": "openai", **(exc.details or {})},
            ) from exc
        except ProviderConnectionError as exc:
            raise AIServiceError(
                message=f"LLM connection error: {exc.message}",
                code="AI_CONNECTION_ERROR",
                details={"provider": "openai", **(exc.details or {})},
            ) from exc
        except ProviderResponseError as exc:
            raise AIServiceError(
                message=f"LLM response error: {exc.message}",
                code="AI_PROVIDER_ERROR",
                details={"provider": "openai", **(exc.details or {})},
            ) from exc
        except ProviderError as exc:
            raise AIServiceError(
                message=f"LLM provider error: {exc.message}",
                code="AI_PROVIDER_ERROR",
                details={"provider": "openai", **(exc.details or {})},
            ) from exc

    def _call_groq(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
        deterministic_response: Optional[str] = None,
    ) -> str:
        """Legacy hook: Groq calls route through :class:`GroqProvider`."""
        provider = GroqProvider(
            model=model,
            api_key=settings.groq_api_key,
            timeout_seconds=settings.llm_timeout_seconds,
            deterministic_response=deterministic_response,
        )
        try:
            return str(
                provider.generate(
                    LLMRequest(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        timeout=timeout,
                        deterministic=bool(settings.ai_deterministic_mode),
                    )
                ).content
            )
        except ProviderTimeoutError as exc:
            raise AIServiceError(
                message=(
                    f"LLM request timed out after "
                    f"{exc.details.get('timeout_seconds')}s"
                ),
                code="AI_TIMEOUT",
                details={"provider": "groq", **(exc.details or {})},
            ) from exc
        except ProviderConnectionError as exc:
            raise AIServiceError(
                message=f"LLM connection error: {exc.message}",
                code="AI_CONNECTION_ERROR",
                details={"provider": "groq", **(exc.details or {})},
            ) from exc
        except ProviderResponseError as exc:
            raise AIServiceError(
                message=f"LLM response error: {exc.message}",
                code="AI_PROVIDER_ERROR",
                details={"provider": "groq", **(exc.details or {})},
            ) from exc
        except ProviderError as exc:
            raise AIServiceError(
                message=f"LLM provider error: {exc.message}",
                code="AI_PROVIDER_ERROR",
                details={"provider": "groq", **(exc.details or {})},
            ) from exc

    def _call_test(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        """Legacy hook retained for tests that patch ``_call_test`` directly."""
        # Delegates to the FixtureLLMProvider which uses the same
        # fixture file as the legacy TestProvider.  Kept stable so
        # test mocks that replace ``_call_test`` continue to work.
        from services.providers import FixtureLLMProvider

        provider = FixtureLLMProvider()
        return str(
            provider.generate(
                LLMRequest(system_prompt=system_prompt, user_prompt=user_prompt)
            ).content
        )

    # ------------------------------------------------------------------
    # Pure helpers
    # ------------------------------------------------------------------

    def _get_deterministic_response(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        stable_response = {
            "verdict": "credible",
            "confidence": 0.74,
            "summary": "Deterministic verification output for testing",
        }
        return json.dumps(stable_response, separators=(",", ":"), sort_keys=True)

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        normalized = content.strip()
        if normalized.startswith("```"):
            normalized = normalized.strip("`")
            if normalized.startswith("json"):
                normalized = normalized[4:].strip()
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise RuntimeError("LLM response must be a JSON object")
        return parsed
