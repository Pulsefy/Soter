"""Provider interface package for swapping LLM and OCR backends without changes to route logic.

This package introduces clean abstract contracts for LLM (``LLMProvider``) and
OCR (``OCRProvider``) backends so that concrete implementations (OpenAI,
Groq, Tesseract, fixture-based, ...) can be registered once and consumed by
the verification services via the ``LLMProviderRegistry`` and
``OCRProviderSelector`` helpers.

Public API summary
------------------

LLM side
    * :class:`LLMProvider` - abstract contract.
    * :class:`LLMRequest` / :class:`LLMResponse` - transport-agnostic value types.
    * :class:`LLMProviderRegistry` - resolves providers by name and yields a
      deterministic attempt order for callers.
    * :func:`build_default_llm_registry` - wires the reference providers
      (OpenAI, Groq, fixture/test) using the global Settings instance.
    * :class:`OpenAIProvider`, :class:`GroqProvider`,
      :class:`FixtureLLMProvider` - reference implementations.

OCR side
    * :class:`OCRProvider` - abstract contract.
    * :class:`OCRRequest` / :class:`OCRProviderOutput` - transport-agnostic
      value types.
    * :class:`OCRProviderSelector` - picks the right provider for the
      current configuration (Tesseract vs fixture).
    * :class:`TesseractOCRProvider`, :class:`FixtureOCRProvider` - reference
      implementations.

Adding a new provider never requires changing route handlers or any of the
verification services.  Only the registry/selector needs to know about a
new backing implementation.
"""

from services.providers.base import (
    LLMProvider,
    LLMRequest,
    LLMResponse,
    OCRProvider,
    OCRProviderOutput,
    OCRRequest,
    ProviderConfigurationError,
    ProviderConnectionError,
    ProviderError,
    ProviderResponseError,
    ProviderTimeoutError,
)
from services.providers.llm import (
    FixtureLLMProvider,
    GroqProvider,
    LLMProviderRegistry,
    OpenAIProvider,
    build_default_llm_registry,
)
from services.providers.ocr import (
    FixtureOCRProvider,
    OCRProviderSelector,
    TesseractOCRProvider,
    build_default_ocr_selector,
)

__all__ = [
    # LLM abstractions
    "LLMProvider",
    "LLMRequest",
    "LLMResponse",
    "LLMProviderRegistry",
    "OpenAIProvider",
    "GroqProvider",
    "FixtureLLMProvider",
    "build_default_llm_registry",
    # OCR abstractions
    "OCRProvider",
    "OCRRequest",
    "OCRProviderOutput",
    "OCRProviderSelector",
    "TesseractOCRProvider",
    "FixtureOCRProvider",
    "build_default_ocr_selector",
    # Exception hierarchy
    "ProviderError",
    "ProviderConfigurationError",
    "ProviderConnectionError",
    "ProviderTimeoutError",
    "ProviderResponseError",
]
