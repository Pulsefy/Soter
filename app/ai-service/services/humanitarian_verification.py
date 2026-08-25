"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Optional
import time
import metrics

from config import settings
from exceptions import AllProvidersExhaustedError
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.circuit_breaker import CircuitBreaker
from services.providers import ProviderRegistry, ModelProvider, LLMResponse

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(self, registry: Optional[ProviderRegistry] = None):
        self.prompt_engine = HumanitarianPromptEngine()
        self.registry = registry or ProviderRegistry()
        self.breakers: Dict[str, CircuitBreaker] = {}

    def _get_breaker(self, provider_name: str) -> CircuitBreaker:
        if provider_name not in self.breakers:
            self.breakers[provider_name] = CircuitBreaker(
                name=provider_name,
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            )
        return self.breakers[provider_name]

    def verify_claim(
        self,
        aid_claim: str,
        supporting_evidence: Optional[List[str]] = None,
        context_factors: Optional[Dict[str, Any]] = None,
        provider_preference: str = "auto",
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Verify a humanitarian aid claim using configured LLM providers.

        The method iterates through the fallback list in the order defined by
        ``LLM_PROVIDER_ORDER`` (or the built-in implicit order when unset).
        Providers with an open circuit breaker are skipped automatically.

        Returns a dict that always contains a ``provider`` key recording which
        provider actually served the request.

        Raises:
            AllProvidersExhaustedError: when every provider in the fallback
                list has been tried (and failed) or is circuit-open.
        """
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

            providers = self.registry.resolve_llm(
                provider_preference, breaker_map=self.breakers
            )
            if not providers:
                raise AllProvidersExhaustedError(
                    providers_tried=[],
                    errors=["No LLM providers configured or all circuits are open"],
                )

            errors: List[str] = []
            providers_tried: List[str] = []

            for provider_name, provider in providers:
                breaker = self._get_breaker(provider_name)
                if not breaker.allow_request():
                    # breaker_map already filters these out, but guard defensively
                    logger.warning(
                        "Circuit breaker is OPEN for provider=%s. Skipping.",
                        provider_name,
                    )
                    errors.append(
                        f"provider={provider_name}, error=Circuit breaker is OPEN"
                    )
                    continue

                providers_tried.append(provider_name)
                model = self._get_model_for_provider(provider_name)
                for prompt_variant, prompt in (
                    ("primary", primary_prompt),
                    ("fallback", fallback_prompt),
                ):
                    try:
                        logger.info(
                            "Attempting humanitarian verification with provider=%s model=%s prompt=%s",
                            provider_name,
                            model,
                            prompt_variant,
                        )
                        response = provider.llm_chat(
                            system_prompt=prompt["system"],
                            user_prompt=prompt["user"],
                            model=model,
                            timeout=timeout,
                        )
                        parsed = self._parse_json_response(response.content)
                        breaker.record_success()
                        # ``provider`` is always present in the result dict so
                        # callers can record which backend served the request.
                        return {
                            "provider": provider_name,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "verification": parsed,
                            "raw_response": response.content,
                        }
                    except Exception as exc:
                        breaker.record_failure()
                        err = f"provider={provider_name}, model={model}, prompt={prompt_variant}, error={exc}"
                        errors.append(err)
                        logger.warning(
                            "Humanitarian verification attempt failed: %s", err
                        )

            raise AllProvidersExhaustedError(
                providers_tried=providers_tried,
                errors=errors,
            )
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name="verify").observe(latency)

    def all_providers_unavailable(self) -> bool:
        """Return True when every configured LLM provider circuit is open."""
        if settings.test_provider_mode:
            return False

        providers = self.registry.available_llm_providers()
        if not providers:
            return False

        return all(not self._get_breaker(p).allow_request() for p in providers)

    def get_model_version(self, provider_preference: str = "auto") -> str:
        providers = self.registry.resolve_llm(provider_preference)
        if not providers:
            return "none:none"
        provider_name = providers[0][0]
        model = self._get_model_for_provider(provider_name)
        return f"{provider_name}:{model}"

    def _get_model_for_provider(self, provider: str) -> str:
        if provider == "test":
            return "test-provider/fixture"
        if provider == "openai":
            return settings.openai_model
        if provider == "groq":
            return settings.groq_model
        raise ValueError(f"Unsupported provider: {provider}")

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
