"""Abstract provider interface and concrete implementations for LLM and OCR.

Issue #615 — Provider Interface for LLM + OCR

Defines a uniform ``ModelProvider`` abstraction with two capability methods:

* ``llm_chat`` — send a system+user prompt pair and return the raw text response.
* ``ocr_extract`` — extract structured fields and raw text from a PIL image.

Concrete providers implement only the capabilities they support; unsupported
operations raise ``NotImplementedError``.  A thin ``ProviderRegistry`` resolves
the right provider for a given capability and provider name.
"""

from __future__ import annotations

import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx

from config import settings
from exceptions import AIServiceError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class LLMResponse:
    """Structured return value from an LLM provider."""

    content: str
    provider: str
    model: str
    latency_ms: int = 0


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
            return LLMResponse(content=stable, provider=provider_name, model=model)

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

        return LLMResponse(
            content=str(content),
            provider=provider_name,
            model=model,
            latency_ms=int((time.time() - start) * 1000),
        )


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
        return LLMResponse(
            content=content, provider="test", model="test-provider/fixture"
        )

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
