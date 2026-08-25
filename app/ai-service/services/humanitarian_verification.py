"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Literal, Optional
import time
import metrics
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from config import settings
from exceptions import AIProviderMalformedResponseError, AIProviderRefusalError
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.circuit_breaker import CircuitBreaker
from services.providers import ProviderRegistry, ModelProvider, LLMResponse

logger = logging.getLogger(__name__)


class CriterionAssessment(BaseModel):
    criterion: str
    status: Literal["met", "partially_met", "not_met", "unknown"]
    reason: str


class HumanitarianVerificationResult(BaseModel):
    """Schema returned by humanitarian verification providers."""

    model_config = ConfigDict(extra="allow")

    verdict: Literal["credible", "partially_credible", "inconclusive", "not_credible"]
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    criteria_assessment: Optional[List[CriterionAssessment]] = None
    risk_flags: Optional[List[str]] = None
    missing_information: Optional[List[str]] = None
    recommended_next_steps: Optional[List[str]] = None


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

            providers = self.registry.resolve_llm(provider_preference)
            if not providers:
                raise RuntimeError(
                    "No LLM providers configured for humanitarian verification"
                )

            errors: List[str] = []
            typed_error = None

            for provider_name, provider in providers:
                breaker = self._get_breaker(provider_name)
                if not breaker.allow_request():
                    logger.warning(
                        "Circuit breaker is OPEN for provider=%s. Skipping.",
                        provider_name,
                    )
                    errors.append(
                        f"provider={provider_name}, error=Circuit breaker is OPEN"
                    )
                    continue

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
                        parsed = self._parse_provider_response(
                            provider=provider,
                            response=response,
                            prompt=prompt,
                            model=model,
                            timeout=timeout,
                        )
                        breaker.record_success()
                        return {
                            "provider": provider_name,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "verification": parsed,
                            "raw_response": response.content,
                        }
                    except Exception as exc:
                        breaker.record_failure()
                        if isinstance(
                            exc,
                            (AIProviderMalformedResponseError, AIProviderRefusalError),
                        ):
                            typed_error = exc
                        err = f"provider={provider_name}, model={model}, prompt={prompt_variant}, error={exc}"
                        errors.append(err)
                        logger.warning(
                            "Humanitarian verification attempt failed: %s", err
                        )

            if typed_error is not None:
                raise typed_error
            raise RuntimeError(
                "All humanitarian verification attempts failed: " + " | ".join(errors)
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
            lines = normalized.splitlines()
            if lines and lines[0].strip().lower() in ("```", "```json"):
                normalized = "\n".join(
                    lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
                )
        try:
            parsed = json.loads(normalized)
        except (json.JSONDecodeError, TypeError) as exc:
            raise AIProviderMalformedResponseError(
                "Provider returned malformed JSON",
                details={"reason": str(exc)},
            ) from exc
        if not isinstance(parsed, dict):
            raise AIProviderMalformedResponseError(
                "Provider response must be a JSON object"
            )
        return parsed

    @staticmethod
    def _is_refusal(content: str) -> bool:
        text = content.strip().lower()
        refusal_markers = (
            "i can't",
            "i cannot",
            "i’m unable",
            "i am unable",
            "i won't",
            "i will not",
            "i refuse",
            "cannot comply",
            "not able to",
        )
        return any(marker in text for marker in refusal_markers)

    def _parse_provider_response(
        self,
        provider: ModelProvider,
        response: LLMResponse,
        prompt: Dict[str, str],
        model: str,
        timeout: Optional[float],
    ) -> Dict[str, Any]:
        if self._is_refusal(response.content):
            raise AIProviderRefusalError(
                "Provider refused the humanitarian verification request",
                details={"provider": response.provider, "model": model},
            )
        try:
            parsed = self._parse_json_response(response.content)
            return HumanitarianVerificationResult.model_validate(parsed).model_dump(
                exclude_none=True
            )
        except (ValidationError, AIProviderMalformedResponseError):
            pass

        # A single repair request is enough to handle truncated/prose output
        # without allowing malformed providers to consume unbounded capacity.
        repair = provider.llm_chat(
            system_prompt=prompt["system"],
            user_prompt=(
                "Reformat your previous answer. Return only one complete JSON object "
                "matching the requested schema; do not add prose or markdown.\n\n"
                f"Previous answer:\n{response.content}"
            ),
            model=model,
            timeout=timeout,
        )
        if self._is_refusal(repair.content):
            raise AIProviderRefusalError(
                "Provider refused the humanitarian verification repair request",
                details={"provider": repair.provider, "model": model},
            )
        try:
            repaired = self._parse_json_response(repair.content)
            return HumanitarianVerificationResult.model_validate(repaired).model_dump(
                exclude_none=True
            )
        except ValidationError as exc:
            raise AIProviderMalformedResponseError(
                "Provider response remained invalid after repair attempt",
                details={"provider": repair.provider, "errors": exc.errors()},
            ) from exc
        except AIProviderMalformedResponseError as exc:
            raise AIProviderMalformedResponseError(
                "Provider response remained malformed after repair attempt",
                details={"provider": repair.provider, "reason": str(exc)},
            ) from exc
