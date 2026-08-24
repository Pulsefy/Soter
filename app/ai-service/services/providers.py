"""Abstract provider interface and concrete implementations for LLM and OCR.

Issue #615 — Provider Interface for LLM + OCR
Issue #981 — Token usage & cost accounting per request

Defines a uniform ``ModelProvider`` abstraction with two capability methods:

* ``llm_chat`` — send a system+user prompt pair and return the raw text response.
* ``ocr_extract`` — extract structured fields and raw text from a PIL image.

Concrete providers implement only the capabilities they support; unsupported
operations raise ``NotImplementedError``.  A thin ``ProviderRegistry`` resolves
the right provider for a given capability and provider name.

LLM providers additionally capture the token usage reported by the upstream
API (when available) and export it as Prometheus metrics labelled by provider,
model and calling endpoint, alongside an estimated USD cost derived from the
configurable per-model rates in ``config.settings.token_cost_rates``.
"""

from __future__ import annotations

import contextvars
import json
import logging
import time
from abc import ABC, abstractmethod
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx

import metrics
from config import settings
from exceptions import AIServiceError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class LLMResponse:
    """Structured return value from an LLM provider.

    Token fields are ``None`` when the provider did not report usage for the
    request; missing usage is accounted separately rather than as zero.
    """

    content: str
    provider: str
    model: str
    latency_ms: int = 0
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


# ---------------------------------------------------------------------------
# Token usage & cost accounting (Issue #981)
# ---------------------------------------------------------------------------

#: Endpoint attribution for metrics. Callers wrap provider dispatch in
#: ``usage_endpoint(...)`` so spend can be attributed per API capability.
_usage_endpoint: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "usage_endpoint", default=None
)

_BUILTIN_ENDPOINT_LABELS = frozenset({"humanitarian_verification"})
_BUILTIN_PROVIDER_LABELS = frozenset({"openai", "groq", "test", "tesseract"})
_UNKNOWN_MODEL_LABEL = "other"
_UNATTRIBUTED_ENDPOINT_LABEL = "unattributed"
_TEST_MODEL_LABEL = "test-provider/fixture"


@contextmanager
def usage_endpoint(endpoint: str):
    """Attribute token usage recorded inside the block to ``endpoint``."""
    token = _usage_endpoint.set(endpoint)
    try:
        yield
    finally:
        _usage_endpoint.reset(token)


def _normalize_provider_label(provider: Optional[str]) -> str:
    name = (provider or "").strip()
    if not name:
        return "unknown"
    return name if name in _BUILTIN_PROVIDER_LABELS else _UNKNOWN_MODEL_LABEL


def _normalize_model_label(model: Optional[str]) -> str:
    name = (model or "").strip()
    if not name:
        return _UNKNOWN_MODEL_LABEL
    if name == _TEST_MODEL_LABEL:
        return name
    allowlist: Set[str] = set()
    rates = getattr(settings, "token_cost_rates", None)
    if isinstance(rates, dict):
        allowlist.update(str(key) for key in rates)
    for attr in ("openai_model", "groq_model"):
        value = getattr(settings, attr, None)
        if isinstance(value, str):
            allowlist.add(value)
    return name if name in allowlist else _UNKNOWN_MODEL_LABEL


def _normalize_endpoint_label(endpoint: Optional[str]) -> str:
    name = (endpoint or "").strip()
    if not name:
        return _UNATTRIBUTED_ENDPOINT_LABEL
    return name if name in _BUILTIN_ENDPOINT_LABELS else _UNKNOWN_MODEL_LABEL


def current_usage_endpoint() -> str:
    """Return the normalized endpoint label for the current context."""
    return _normalize_endpoint_label(_usage_endpoint.get())


def get_model_cost_rates(model: str) -> Tuple[float, float]:
    """Return ``(prompt_rate, completion_rate)`` USD per 1k tokens for ``model``."""
    rates = getattr(settings, "token_cost_rates", None)
    if isinstance(rates, dict):
        entry = rates.get(model)
        if isinstance(entry, dict):
            prompt_rate = entry.get("prompt")
            completion_rate = entry.get("completion")
            if (
                isinstance(prompt_rate, (int, float))
                and prompt_rate >= 0
                and isinstance(completion_rate, (int, float))
                and completion_rate >= 0
            ):
                return float(prompt_rate), float(completion_rate)

    default_prompt = getattr(settings, "token_cost_default_prompt_rate", 0.0)
    default_completion = getattr(settings, "token_cost_default_completion_rate", 0.0)
    prompt_rate = default_prompt if isinstance(default_prompt, (int, float)) else 0.0
    completion_rate = (
        default_completion if isinstance(default_completion, (int, float)) else 0.0
    )
    return max(0.0, float(prompt_rate)), max(0.0, float(completion_rate))


def estimate_token_cost_usd(
    model: str, prompt_tokens: int, completion_tokens: int
) -> float:
    """Estimate USD cost for the given token counts using configured rates."""
    prompt_rate, completion_rate = get_model_cost_rates(model)
    cost = (prompt_tokens / 1000.0) * prompt_rate
    cost += (completion_tokens / 1000.0) * completion_rate
    return max(0.0, cost)


def _usage_int_or_none(value: Any) -> Optional[int]:
    """Coerce a provider-reported usage value to a non-negative int or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0, int(value))


def record_llm_token_usage(response: LLMResponse) -> None:
    """Export token usage/cost metrics for a completed LLM request.

    Requests where the provider did not report usage are counted separately
    via ``ai_token_usage_unavailable_total`` instead of being recorded as
    zero tokens.
    """
    try:
        provider_label = _normalize_provider_label(response.provider)
        # Cost is estimated from the raw model name so unconfigured models can
        # still fall back to the default rates before label normalization.
        cost_model = (response.model or "").strip() or _UNKNOWN_MODEL_LABEL
        model_label = _normalize_model_label(response.model)
        endpoint_label = current_usage_endpoint()
        labels = {
            "provider": provider_label,
            "model": model_label,
            "endpoint": endpoint_label,
        }

        prompt_tokens = response.prompt_tokens
        completion_tokens = response.completion_tokens
        if prompt_tokens is None and completion_tokens is None:
            metrics.TOKEN_USAGE_UNAVAILABLE_TOTAL.labels(**labels).inc()
            return

        prompt_count = int(prompt_tokens or 0)
        completion_count = int(completion_tokens or 0)
        if prompt_count > 0:
            metrics.TOKEN_USAGE_TOTAL.labels(**labels, token_type="prompt").inc(
                prompt_count
            )
        if completion_count > 0:
            metrics.TOKEN_USAGE_TOTAL.labels(
                **labels, token_type="completion"
            ).inc(completion_count)
        if prompt_count > 0 or completion_count > 0:
            cost = estimate_token_cost_usd(cost_model, prompt_count, completion_count)
            if cost > 0:
                metrics.TOKEN_COST_ESTIMATED_USD_TOTAL.labels(**labels).inc(cost)
        else:
            # Provider reported a usage object but no positive token counts;
            # treat as unavailable rather than silently recording zeros.
            metrics.TOKEN_USAGE_UNAVAILABLE_TOTAL.labels(**labels).inc()
    except Exception:  # pragma: no cover - accounting must never break requests
        logger.exception("Failed to record LLM token usage")


@dataclass
class OCRField:
    """A single detected field from OCR."""

    value: str
    confidence: float


@dataclass
class OCRResponse:
    """Structured return value from an OCR provider."""

    fields: Dict[str, OCRField]
    raw_text: str
    processing_time_ms: int
    provider: str


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class ModelProvider(ABC):
    """Base class for all model providers.

    Subclasses MUST implement the methods corresponding to the capabilities
    they provide.  The default implementations raise ``NotImplementedError``.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique lowercase identifier for this provider (e.g. ``openai``)."""

    def llm_chat(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> LLMResponse:
        """Send a chat completion request and return the text response.

        Raises ``NotImplementedError`` if this provider does not support LLM.
        """
        raise NotImplementedError(f"{self.name} does not support llm_chat")

    def ocr_extract(
        self,
        image: Any,
        *,
        language_hint: Optional[str] = None,
    ) -> OCRResponse:
        """Extract text fields from a PIL Image.

        Raises ``NotImplementedError`` if this provider does not support OCR.
        """
        raise NotImplementedError(f"{self.name} does not support ocr_extract")


# ---------------------------------------------------------------------------
# OpenAI provider
# ---------------------------------------------------------------------------


class OpenAIProvider(ModelProvider):
    """LLM provider backed by the OpenAI chat completions API."""

    @property
    def name(self) -> str:
        return "openai"

    def llm_chat(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> LLMResponse:
        if not settings.openai_api_key:
            raise RuntimeError("OpenAI API key is not configured")
        resolved_model = model or settings.openai_model
        return self._call_chat_completion(
            base_url="https://api.openai.com/v1/chat/completions",
            api_key=settings.openai_api_key,
            model=resolved_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    @staticmethod
    def _call_chat_completion(
        base_url: str,
        api_key: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> LLMResponse:
        provider_name = "openai" if "openai" in base_url else "groq"
        if settings.ai_deterministic_mode:
            logger.info("Deterministic AI mode enabled: returning stable response")
            stable = json.dumps(
                {
                    "verdict": "credible",
                    "confidence": 0.74,
                    "summary": "Deterministic verification output for testing",
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            response = LLMResponse(content=stable, provider=provider_name, model=model)
            record_llm_token_usage(response)
            return response

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
        req_timeout = (
            timeout if timeout is not None else float(settings.llm_timeout_seconds)
        )
        start = time.time()

        try:
            with httpx.Client(timeout=req_timeout) as client:
                response = client.post(base_url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            raise AIServiceError(
                message=f"LLM request timed out after {req_timeout}s",
                code="AI_TIMEOUT",
                details={"provider": provider_name, "timeout_seconds": req_timeout},
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise AIServiceError(
                message=f"LLM request failed with status {exc.response.status_code}",
                code="AI_PROVIDER_ERROR",
                details={
                    "provider": provider_name,
                    "status_code": exc.response.status_code,
                },
            ) from exc
        except Exception as exc:
            raise AIServiceError(
                message=f"LLM connection error: {exc}",
                code="AI_CONNECTION_ERROR",
                details={"provider": provider_name},
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected LLM response format: {data}") from exc
        if not content:
            raise RuntimeError("LLM returned empty content")

        usage = data.get("usage") if isinstance(data, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        llm_response = LLMResponse(
            content=str(content),
            provider=provider_name,
            model=model,
            latency_ms=int((time.time() - start) * 1000),
            prompt_tokens=_usage_int_or_none(usage.get("prompt_tokens")),
            completion_tokens=_usage_int_or_none(usage.get("completion_tokens")),
            total_tokens=_usage_int_or_none(usage.get("total_tokens")),
        )
        record_llm_token_usage(llm_response)
        return llm_response


# ---------------------------------------------------------------------------
# Groq provider
# ---------------------------------------------------------------------------


class GroqProvider(ModelProvider):
    """LLM provider backed by the Groq chat completions API."""

    @property
    def name(self) -> str:
        return "groq"

    def llm_chat(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> LLMResponse:
        if not settings.groq_api_key:
            raise RuntimeError("Groq API key is not configured")
        resolved_model = model or settings.groq_model
        return OpenAIProvider._call_chat_completion(
            base_url="https://api.groq.com/openai/v1/chat/completions",
            api_key=settings.groq_api_key,
            model=resolved_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )


# ---------------------------------------------------------------------------
# Test / fixture-driven provider (LLM + OCR)
# ---------------------------------------------------------------------------


class FixtureProvider(ModelProvider):
    """Fixture-driven provider for staging/testnet (no API keys).

    Supports both LLM chat and OCR extraction via the underlying ``TestProvider``.
    """

    def __init__(self) -> None:
        from services.test_provider import TestProvider

        self._inner = TestProvider()

    @property
    def name(self) -> str:
        return "test"

    def llm_chat(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> LLMResponse:
        response = self._inner.get_response(
            endpoint="humanitarian",
            request_data={"system_prompt": system_prompt, "user_prompt": user_prompt},
        )
        content = json.dumps(response, separators=(",", ":"), sort_keys=True)
        llm_response = LLMResponse(
            content=content, provider="test", model="test-provider/fixture"
        )
        record_llm_token_usage(llm_response)
        return llm_response

    def ocr_extract(
        self,
        image: Any,
        *,
        language_hint: Optional[str] = None,
    ) -> OCRResponse:
        image_size = getattr(image, "size", (0, 0))
        response = self._inner.get_response("ocr", {"image_size": str(image_size)})

        fields: Dict[str, OCRField] = {}
        for fname, fdata in response.get("fields", {}).items():
            fields[fname] = OCRField(
                value=fdata["value"], confidence=fdata["confidence"]
            )

        return OCRResponse(
            fields=fields,
            raw_text=response.get("raw_text", ""),
            processing_time_ms=response.get("processing_time_ms", 0),
            provider="test",
        )


# ---------------------------------------------------------------------------
# Tesseract OCR provider
# ---------------------------------------------------------------------------


class TesseractOCRProvider(ModelProvider):
    """OCR provider using local Tesseract via pytesseract."""

    @property
    def name(self) -> str:
        return "tesseract"

    def ocr_extract(
        self,
        image: Any,
        *,
        language_hint: Optional[str] = None,
    ) -> OCRResponse:
        import pytesseract

        start = time.time()
        config = "--psm 6 --oem 3"
        kwargs: Dict[str, Any] = {
            "config": config,
            "output_type": pytesseract.Output.DICT,
        }
        if language_hint:
            kwargs["lang"] = language_hint
        data = pytesseract.image_to_data(image, **kwargs)

        raw_text = data.get("text", "")
        if isinstance(raw_text, list):
            raw_text = " ".join(str(t) for t in raw_text if t)
        raw_text = str(raw_text) if raw_text else ""

        from services.ocr import FieldDetector

        detector = FieldDetector()
        fields_dict = detector.detect_fields(raw_text)

        texts_list = data.get("text", [])
        confs_list = data.get("conf", [])
        if isinstance(texts_list, str):
            texts_list = [texts_list]
        if isinstance(confs_list, (int, float)):
            confs_list = [confs_list]

        fields: Dict[str, OCRField] = {}
        for field_name, field_match in fields_dict.items():
            char_confs: List[float] = []
            for i, text in enumerate(texts_list):
                if field_match.value.lower() in str(text).lower() and i < len(
                    confs_list
                ):
                    try:
                        conf = float(confs_list[i])
                        if conf > 0:
                            char_confs.append(conf / 100.0)
                    except (ValueError, TypeError):
                        pass
            aggregated = sum(char_confs) / len(char_confs) if char_confs else 0.8
            fields[field_name] = OCRField(
                value=field_match.value, confidence=aggregated
            )

        latency_ms = int((time.time() - start) * 1000)
        return OCRResponse(
            fields=fields,
            raw_text=raw_text,
            processing_time_ms=latency_ms,
            provider="tesseract",
        )


# ---------------------------------------------------------------------------
# Provider Registry
# ---------------------------------------------------------------------------


class ProviderRegistry:
    """Central registry that resolves provider instances by name and capability.

    Capabilities are ``"llm"`` and ``"ocr"``.  Each provider name can
    implement one or both.
    """

    def __init__(self) -> None:
        self._providers: Dict[str, ModelProvider] = {}
        self._register_default_providers()

    def _register_default_providers(self) -> None:
        self.register(OpenAIProvider())
        self.register(GroqProvider())
        self.register(FixtureProvider())
        self.register(TesseractOCRProvider())

    def register(self, provider: ModelProvider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str) -> ModelProvider:
        try:
            return self._providers[name]
        except KeyError:
            raise ValueError(f"Unknown provider: {name}") from None

    def available_llm_providers(self) -> List[str]:
        """Return ordered list of available LLM provider names based on config."""
        available: List[str] = []
        if settings.test_provider_mode:
            available.append("test")
        if settings.openai_api_key:
            available.append("openai")
        if settings.groq_api_key:
            available.append("groq")
        return available

    def available_ocr_providers(self) -> List[str]:
        """Return ordered list of available OCR provider names."""
        available: List[str] = []
        if settings.test_provider_mode:
            available.append("test")
        # Tesseract is always available locally
        available.append("tesseract")
        return available

    def resolve_llm(self, preference: str = "auto") -> List[Tuple[str, ModelProvider]]:
        """Return (name, provider) pairs in attempt order for LLM chat."""
        available = self.available_llm_providers()
        pref = (preference or "auto").lower()
        if pref == "test" and "test" in available:
            return [("test", self.get("test"))]
        if pref in available:
            ordered = [pref] + [p for p in available if p != pref]
        else:
            ordered = available
        return [(name, self.get(name)) for name in ordered]

    def resolve_ocr(self, preference: str = "auto") -> List[Tuple[str, ModelProvider]]:
        """Return (name, provider) pairs in attempt order for OCR."""
        available = self.available_ocr_providers()
        pref = (preference or "auto").lower()
        if pref in available:
            ordered = [pref] + [p for p in available if p != pref]
        else:
            ordered = available
        return [(name, self.get(name)) for name in ordered]
