"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Optional
import time
import metrics

from config import settings
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.circuit_breaker import CircuitBreaker
from services.providers import LLMProvider, get_llm_providers

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(self, providers: Optional[List[LLMProvider]] = None):
        self.prompt_engine = HumanitarianPromptEngine()
        self.providers = providers or get_llm_providers()
        self.breakers: Dict[str, CircuitBreaker] = {}
        for p in self.providers:
            if p.name not in self.breakers:
                self.breakers[p.name] = CircuitBreaker(
                    name=p.name,
                    failure_threshold=settings.circuit_breaker_failure_threshold,
                    recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
                )

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

            ordered = self._provider_attempt_order(provider_preference)
            if not ordered:
                raise RuntimeError("No LLM providers configured for humanitarian verification")

            errors: List[str] = []

            for provider in ordered:
                breaker = self.breakers.get(provider.name)
                if breaker and not breaker.allow_request():
                    logger.warning("Circuit breaker is OPEN for provider=%s. Skipping.", provider.name)
                    errors.append(f"provider={provider.name}, error=Circuit breaker is OPEN")
                    continue

                model = self._get_model_for_provider(provider.name)
                for prompt_variant, prompt in (("primary", primary_prompt), ("fallback", fallback_prompt)):
                    try:
                        logger.info(
                            "Attempting humanitarian verification with provider=%s model=%s prompt=%s",
                            provider.name,
                            model,
                            prompt_variant,
                        )
                        raw_content = provider.call(
                            model=model,
                            system_prompt=prompt["system"],
                            user_prompt=prompt["user"],
                            timeout=timeout,
                        )
                        parsed = self._parse_json_response(raw_content)
                        if breaker:
                            breaker.record_success()
                        return {
                            "provider": provider.name,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "verification": parsed,
                            "raw_response": raw_content,
                        }
                    except Exception as exc:
                        if breaker:
                            breaker.record_failure()
                        err = f"provider={provider.name}, model={model}, prompt={prompt_variant}, error={exc}"
                        errors.append(err)
                        logger.warning("Humanitarian verification attempt failed: %s", err)

            raise RuntimeError("All humanitarian verification attempts failed: " + " | ".join(errors))
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name='verify').observe(latency)

    def _provider_attempt_order(self, provider_preference: str) -> List[LLMProvider]:
        """Return providers ordered so the preferred one (if available) is first."""
        preference = (provider_preference or "auto").lower()
        if preference == "auto" or not self.providers:
            return list(self.providers)

        ordered: List[LLMProvider] = []
        rest: List[LLMProvider] = []
        for p in self.providers:
            if p.name == preference:
                ordered.append(p)
            else:
                rest.append(p)
        return ordered + rest

    def all_providers_unavailable(self) -> bool:
        """Return True when every configured LLM provider circuit is open."""
        for p in self.providers:
            if p.name not in self.breakers or self.breakers[p.name].allow_request():
                return False
        return len(self.providers) > 0

    def _get_model_for_provider(self, provider_name: str) -> str:
        if provider_name == "test":
            return "test-provider/fixture"
        if provider_name == "openai":
            return settings.openai_model
        if provider_name == "groq":
            return settings.groq_model
        raise ValueError(f"Unsupported provider: {provider_name}")

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