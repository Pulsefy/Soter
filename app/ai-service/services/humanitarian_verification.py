"""Humanitarian claim verification service with model/provider fallbacks and prompt versioning."""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import time
import metrics

from pydantic import ValidationError

from config import settings
from exceptions import (
    ProviderExhaustedError,
    MalformedProviderOutputError,
    ProviderRefusalError,
)
from schemas.humanitarian import LLMVerificationPayload
from services.humanitarian_prompt import (
    HumanitarianPromptEngine,
    default_prompt_registry,
)
from services.prompt_registry import PromptRegistry
from services.circuit_breaker import CircuitBreaker
from services.providers import ProviderRegistry, ModelProvider, LLMResponse

logger = logging.getLogger(__name__)

# Total attempts against a single (provider, prompt_variant) combination
# before giving up as persistently malformed: the initial call plus this
# many reformat/repair retries.
_MAX_ATTEMPTS_PER_PROMPT = 2

# Substrings (checked case-insensitively) that indicate the model declined
# to answer at all, rather than attempting the requested output. Not
# exhaustive by design -- broad enough to catch common refusal phrasing
# without flagging legitimate "inconclusive" verdicts, which are a real,
# valid answer, not a refusal.
_REFUSAL_MARKERS: Tuple[str, ...] = (
    "i cannot assist",
    "i can't assist",
    "i cannot help",
    "i can't help",
    "i cannot provide",
    "i can't provide",
    "i'm unable to",
    "i am unable to",
    "i must decline",
    "i won't be able to",
    "as an ai language model",
    "against my guidelines",
)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers with versioned prompts."""

    def __init__(
        self,
        registry: Optional[ProviderRegistry] = None,
        prompt_registry: Optional[PromptRegistry] = None,
    ):
        self.prompt_registry = prompt_registry or default_prompt_registry
        self._apply_settings_prompt_versions()
        self.prompt_engine = HumanitarianPromptEngine(registry=self.prompt_registry)
        self.registry = registry or ProviderRegistry()
        self.breakers: Dict[str, CircuitBreaker] = {}

    def _apply_settings_prompt_versions(self) -> None:
        """Apply active prompt versions configured in settings if registered."""
        if hasattr(settings, "humanitarian_primary_prompt_version"):
            primary_v = settings.humanitarian_primary_prompt_version
            if self.prompt_registry.has("humanitarian_primary", primary_v):
                self.prompt_registry.set_active_version(
                    "humanitarian_primary", primary_v
                )

        if hasattr(settings, "humanitarian_fallback_prompt_version"):
            fallback_v = settings.humanitarian_fallback_prompt_version
            if self.prompt_registry.has("humanitarian_fallback", fallback_v):
                self.prompt_registry.set_active_version(
                    "humanitarian_fallback", fallback_v
                )

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
        prompt_version: Optional[str] = None,
        primary_prompt_version: Optional[str] = None,
        fallback_prompt_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        start_time = time.time()
        try:
            evidence = supporting_evidence or []
            context = context_factors or {}

            # Resolve primary and fallback prompt templates from registry
            pri_ver = primary_prompt_version or prompt_version
            primary_prompt_obj = self.prompt_registry.get(
                "humanitarian_primary", version=pri_ver
            )
            primary_prompt = primary_prompt_obj.build_prompt(
                aid_claim=aid_claim,
                supporting_evidence=evidence,
                context_factors=context,
            )

            fb_ver = fallback_prompt_version
            if (
                fb_ver is None
                and prompt_version
                and self.prompt_registry.has("humanitarian_fallback", prompt_version)
            ):
                fb_ver = prompt_version
            fallback_prompt_obj = self.prompt_registry.get(
                "humanitarian_fallback", version=fb_ver
            )
            fallback_prompt = fallback_prompt_obj.build_prompt(
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
                for prompt_variant, prompt_obj, prompt in (
                    ("primary", primary_prompt_obj, primary_prompt),
                    ("fallback", fallback_prompt_obj, fallback_prompt),
                ):
                    try:
                        logger.info(
                            "Attempting humanitarian verification with provider=%s model=%s prompt=%s version=%s",
                            provider_name,
                            model,
                            prompt_variant,
                            prompt_obj.version,
                        )
                        parsed, response = self._call_and_validate(
                            provider=provider,
                            provider_name=provider_name,
                            model=model,
                            prompt=prompt,
                            timeout=timeout,
                        )
                        breaker.record_success()
                        metrics.record_llm_usage(
                            provider=provider_name,
                            model=model,
                            endpoint="humanitarian_verification",
                            prompt_tokens=response.prompt_tokens,
                            completion_tokens=response.completion_tokens,
                        )
                        return {
                            "provider": provider_name,
                            "model": model,
                            "prompt_variant": prompt_variant,
                            "prompt_name": prompt_obj.name,
                            "prompt_version": prompt_obj.version,
                            "verification": parsed,
                            "raw_response": response.content,
                        }
                    except (MalformedProviderOutputError, ProviderRefusalError) as exc:
                        # The provider answered -- the content just wasn't
                        # usable (bad shape) or was a decline (not a
                        # transport problem), so this does not trip the
                        # circuit breaker the way a connection/timeout
                        # failure would.
                        err = f"provider={provider_name}, model={model}, prompt={prompt_variant}, error={exc}"
                        errors.append(err)
                        logger.warning(
                            "Humanitarian verification attempt failed: %s", err
                        )
                    except Exception as exc:
                        breaker.record_failure()
                        err = f"provider={provider_name}, model={model}, prompt={prompt_variant}, version={prompt_obj.version}, error={exc}"
                        errors.append(err)
                        logger.warning(
                            "Humanitarian verification attempt failed: %s", err
                        )

            raise ProviderExhaustedError(
                "All LLM providers were attempted and exhausted: " + " | ".join(errors),
                details={"attempted": errors},
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

    def get_prompt_version(self, prompt_name: str = "humanitarian_primary") -> str:
        """Return the active version string for the given prompt name."""
        return self.prompt_registry.get_active_version(prompt_name)

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

    def _looks_like_refusal(self, content: str) -> bool:
        lowered = content.lower()
        return any(marker in lowered for marker in _REFUSAL_MARKERS)

    def _validate_schema(self, parsed: Dict[str, Any]) -> None:
        """Raises :class:`MalformedProviderOutputError` if `parsed` does not
        match the shape downstream code relies on (see
        `LLMVerificationPayload`). Validation is used only to accept/reject;
        the caller keeps using the original `parsed` dict either way, so a
        provider's extra fields (criteria_assessment, risk_flags, ...) are
        never dropped.
        """
        try:
            LLMVerificationPayload.model_validate(parsed)
        except ValidationError as exc:
            raise MalformedProviderOutputError(
                f"provider output failed schema validation: {exc}",
                details={"parsed": parsed},
            ) from exc

    def _call_and_validate(
        self,
        provider: ModelProvider,
        provider_name: str,
        model: str,
        prompt: Dict[str, str],
        timeout: Optional[float],
    ) -> Tuple[Dict[str, Any], LLMResponse]:
        """Calls `provider` and returns `(validated_payload, response)`.

        On malformed JSON or a schema-validation failure, retries up to
        `_MAX_ATTEMPTS_PER_PROMPT` total attempts, asking the model to
        repair its own previous output each time. Raises
        `ProviderRefusalError` immediately (no repair attempt -- reformatting
        won't turn a decline into an answer) if the response looks like an
        explicit refusal, or `MalformedProviderOutputError` once every
        repair attempt is exhausted.
        """
        system_prompt = prompt["system"]
        user_prompt = prompt["user"]
        last_error: Optional[Exception] = None

        for attempt in range(1, _MAX_ATTEMPTS_PER_PROMPT + 1):
            response = provider.llm_chat(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                timeout=timeout,
            )
            content = response.content

            if self._looks_like_refusal(content):
                raise ProviderRefusalError(
                    f"provider={provider_name} declined to answer",
                    details={"content": content},
                )

            try:
                parsed = self._parse_json_response(content)
                self._validate_schema(parsed)
                return parsed, response
            except (
                json.JSONDecodeError,
                RuntimeError,
                MalformedProviderOutputError,
            ) as exc:
                last_error = exc
                logger.warning(
                    "Malformed output from provider=%s (attempt %d/%d): %s",
                    provider_name,
                    attempt,
                    _MAX_ATTEMPTS_PER_PROMPT,
                    exc,
                )
                if attempt < _MAX_ATTEMPTS_PER_PROMPT:
                    repair_prompt = self.prompt_engine.build_repair_prompt(
                        original_user_prompt=user_prompt,
                        malformed_content=content,
                        error_message=str(exc),
                    )
                    system_prompt = repair_prompt["system"]
                    user_prompt = repair_prompt["user"]

        raise MalformedProviderOutputError(
            f"provider={provider_name} produced malformed output after "
            f"{_MAX_ATTEMPTS_PER_PROMPT} attempts: {last_error}",
            details={"attempts": _MAX_ATTEMPTS_PER_PROMPT},
        )
