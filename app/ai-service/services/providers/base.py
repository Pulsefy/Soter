"""Abstract provider contracts and supporting dataclasses.

These contracts let LLM and OCR backends be swapped without refactoring the
HTTP route handlers.  The verification services depend only on the abstract
interfaces defined here, never on a concrete provider such as OpenAI,
Groq or Tesseract.  New backends are added by writing a new subclass and
registering it with the appropriate ``LLMProviderRegistry`` /
``OCRProviderSelector``.

Design goals
------------
* Stable value types (``LLMRequest``/``LLMResponse``/``OCRProviderOutput``)
  so routes do not need to be aware of provider-specific formats.
* Provider identity is exposed as a ``name`` attribute so callers can
  reason about *which* backend answered and use it to key things such as
  circuit breakers, metrics and logs.
* Provider-specific exceptions live under :class:`ProviderError` so the
  upper layer can convert them to its own domain errors (e.g. an
  ``AIServiceError``) without coupling to any vendor SDK.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from PIL import Image


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ProviderError(Exception):
    """Base class for all provider failures.

    Contain the provider name whenever possible so logs and metrics can be
    attributed correctly even after the exception is caught by a generic
    error handler upstream.
    """

    def __init__(
        self,
        message: str,
        provider: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.details = details or {}


class ProviderConfigurationError(ProviderError):
    """Raised when a provider is unusable due to misconfiguration."""


class ProviderConnectionError(ProviderError):
    """Raised when a network or transport-level error prevents the call."""


class ProviderTimeoutError(ProviderError):
    """Raised when the provider exceeded its timeout budget."""


class ProviderResponseError(ProviderError):
    """Raised when the provider returned an unexpected/malformed payload."""


# ---------------------------------------------------------------------------
# LLM abstractions
# ---------------------------------------------------------------------------


@dataclass
class LLMRequest:
    """Transport-agnostic request payload for a chat-completion style LLM."""

    system_prompt: str
    user_prompt: str
    timeout: Optional[float] = None
    deterministic: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMResponse:
    """Transport-agnostic response payload from an LLM provider."""

    content: str
    provider_name: str
    model: str
    raw: Dict[str, Any] = field(default_factory=dict)


class LLMProvider(ABC):
    """Contract that every language model backend must implement.

    A provider knows its own ``name`` and ``model`` so that consumers do
    not have to maintain a separate lookup table when reporting results
    or wiring circuit breakers.
    """

    name: str
    model: str

    @abstractmethod
    def generate(self, request: LLMRequest) -> LLMResponse:
        """Issue a chat completion and return the raw assistant content."""

    def healthy(self) -> bool:
        """Whether this provider is currently usable.

        The default is ``True``; concrete implementations may override
        to expose richer diagnostics (e.g. cached circuit-breaker state).
        """
        return True

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"<{type(self).__name__} name={self.name} model={self.model}>"


# ---------------------------------------------------------------------------
# OCR abstractions
# ---------------------------------------------------------------------------


@dataclass
class OCRRequest:
    """Transport-agnostic request payload for an OCR engine.

    Attributes:
        image: The image to recognise.  May already have been preprocessed
            by the calling pipeline; the provider does not need to apply
            any further transforms.
        config: An optional engine-specific configuration string that
            can be consumed by implementations such as Tesseract.  The
            contract treats it as opaque.
    """

    image: Image.Image
    config: Optional[str] = None


@dataclass
class OCRProviderOutput:
    """Transport-agnostic OCR output returned by an :class:`OCRProvider`.

    Attributes:
        raw_text: The full recognised text.  The calling pipeline is
            responsible for downstream field extraction.
        processing_time_ms: How long the provider took to produce its
            output, in milliseconds.
        word_data: Optional engine-specific per-word metadata (e.g. the
            ``pytesseract.image_to_data`` dict).  When present, callers
            can derive finer-grained confidence scores from it.
    """

    raw_text: str
    processing_time_ms: int = 0
    word_data: Optional[Dict[str, Any]] = None


class OCRProvider(ABC):
    """Contract that every OCR backend must implement.

    The provider is intentionally narrow: it only knows how to turn an
    image into text.  Preprocessing and field extraction remain in the
    orchestration layer so the abstraction is sturdy across engines that
    expose very different primitives.
    """

    name: str

    @abstractmethod
    def process(self, request: OCRRequest) -> OCRProviderOutput:
        """Run OCR on the supplied image and return raw output."""

    def healthy(self) -> bool:
        """Whether this provider is currently usable."""
        return True

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"<{type(self).__name__} name={self.name}>"
