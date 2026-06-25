"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Optional
import time
import metrics

from config import settings
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.circuit_breaker import CircuitBreaker
from services.provider_factory import get_llm_provider
from exceptions import AIServiceError

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(self):
        self.prompt_engine = HumanitarianPromptEngine()
        self.llm_provider = get_llm_provider()
        self.breakers = {
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
        }

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
                raise RuntimeError("No LLM providers configured for humanitarian verification")

            errors: List[str] = []

            for provider in providers:
                breaker = self.breakers.get(provider)
                if breaker and not breaker.allow_request():
                    logger.warning("Circuit breaker is OPEN for provider=%s. Skipping.", provider)
                    errors.append(f"provider={provider}, error=Circuit breaker is OPEN")
                    continue

                model = self._get_model_for_provider(provider)
                for prompt_variant, prompt in (("primary", primary_prompt), ("fallback", fallback_prompt)):
                    try:
                        logger.info(
                            "Attempting humanitarian verification with provider=%s model=%s prompt=%s",
                            provider,
                            model,
                            prompt_variant,
                        )
                        raw_content = self._call_provider(
                            provider=provider,
                            model=model,
                            system_prompt=prompt["system"],
                            user_prompt=prompt["user"],
                            timeout=timeout,
                        )
                        parsed = self._parse_json_response(raw_content)
                        if breaker:
                            breaker.record_success()
                        return {
                            "provider": provider,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "verification": parsed,
                            "raw_response": raw_content,
                        }
                    except Exception as exc:
                        if breaker:
                            breaker.record_failure()
                        err = f"provider={provider}, model={model}, prompt={prompt_variant}, error={exc}"
                        errors.append(err)
                        logger.warning("Humanitarian verification attempt failed: %s", err)

            raise RuntimeError("All humanitarian verification attempts failed: " + " | ".join(errors))
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name='verify').observe(latency)

    def _provider_attempt_order(self, provider_preference: str) -> List[str]:
        available: List[str] = []
        if settings.test_provider_mode:
            available.append("test")
        if settings.openai_api_key:
            available.append("openai")
        if settings.groq_api_key:
            available.append("groq")

        preference = (provider_preference or "auto").lower()
        if preference == "test" and settings.test_provider_mode:
            return [preference]
        if preference in ("openai", "groq", "test") and preference in available:
            return [preference] + [provider for provider in available if provider != preference]
        return available

    def _get_model_for_provider(self, provider: str) -> str:
        if provider == "test":
            return "test-provider/fixture"
        if provider == "openai":
            return settings.openai_model
        if provider == "groq":
            return settings.groq_model
        raise ValueError(f"Unsupported provider: {provider}")

    def _call_provider(
        self,
        provider: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        return self.llm_provider.send_chat_completion(
            provider=provider,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

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