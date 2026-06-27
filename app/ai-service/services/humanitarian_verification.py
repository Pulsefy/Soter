"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Optional
import time
import metrics

import httpx

from config import settings
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.circuit_breaker import CircuitBreaker
from services.test_provider import TestProvider
from exceptions import AIServiceError

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(self):
        self.prompt_engine = HumanitarianPromptEngine()
        self.test_provider = TestProvider()
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

    def all_providers_unavailable(self) -> bool:
        """Return True when every configured LLM provider circuit is open."""
        if settings.test_provider_mode:
            return False

        providers = []
        if settings.openai_api_key:
            providers.append("openai")
        if settings.groq_api_key:
            providers.append("groq")
        if not providers:
            return False

        return all(
            provider in self.breakers and not self.breakers[provider].allow_request()
            for provider in providers
        )

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
        if provider == "test":
            return self._call_test(model, system_prompt, user_prompt)
        if provider == "openai":
            return self._call_openai(model, system_prompt, user_prompt, timeout)
        if provider == "groq":
            return self._call_groq(model, system_prompt, user_prompt, timeout)
        raise ValueError(f"Unsupported provider: {provider}")

    def _call_openai(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if not settings.openai_api_key:
            raise RuntimeError("OpenAI API key is not configured")
        return self._call_chat_completion_api(
            base_url="https://api.openai.com/v1/chat/completions",
            api_key=settings.openai_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    def _call_groq(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if not settings.groq_api_key:
            raise RuntimeError("Groq API key is not configured")
        return self._call_chat_completion_api(
            base_url="https://api.groq.com/openai/v1/chat/completions",
            api_key=settings.groq_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    def _call_chat_completion_api(
        self,
        base_url: str,
        api_key: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if settings.ai_deterministic_mode:
            logger.info("Deterministic AI mode enabled: returning stable response")
            return self._get_deterministic_response(model, system_prompt, user_prompt)

        payload = {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        req_timeout = timeout if timeout is not None else float(settings.llm_timeout_seconds)
        provider_name = "openai" if "openai" in base_url else "groq"

        try:
            with httpx.Client(timeout=req_timeout) as client:
                response = client.post(base_url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            logger.error("LLM provider %s request timed out after %s seconds", provider_name, req_timeout)
            raise AIServiceError(
                message=f"LLM request timed out after {req_timeout}s",
                code="AI_TIMEOUT",
                details={"provider": provider_name, "timeout_seconds": req_timeout},
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error("LLM provider %s returned status %s: %s", provider_name, exc.response.status_code, exc.response.text)
            raise AIServiceError(
                message=f"LLM request failed with status {exc.response.status_code}",
                code="AI_PROVIDER_ERROR",
                details={"provider": provider_name, "status_code": exc.response.status_code},
            ) from exc
        except Exception as exc:
            logger.error("LLM provider %s connection or unexpected error: %s", provider_name, str(exc))
            raise AIServiceError(
                message=f"LLM connection error: {str(exc)}",
                code="AI_CONNECTION_ERROR",
                details={"provider": provider_name},
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected LLM response format: {data}") from exc

        if not content:
            raise RuntimeError("LLM returned empty content")

        return str(content)

    def _call_test(self, model: str, system_prompt: str, user_prompt: str) -> str:
        response = self.test_provider.get_response(
            endpoint="humanitarian",
            request_data={
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            },
        )
        return json.dumps(response, separators=(",", ":"), sort_keys=True)

    def _get_deterministic_response(self, model: str, system_prompt: str, user_prompt: str) -> str:
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