"""OCR provider implementations and an :class:`OCRProviderSelector`.

The OCR side is a little different from the LLM side: there is at most
one *active* OCR backend at a time (Tesseract in production, a fixture
provider when ``test_provider_mode`` is enabled) and we don't really
need a fallback chain.  We still keep a tiny selector abstraction so
that future backends (cloud OCR APIs, GCVision, ...) can be dropped in
without touching :class:`services.ocr.OCRService`.

Reference implementations
------------------------
* :class:`TesseractOCRProvider` - wraps ``pytesseract.image_to_data``.
* :class:`FixtureOCRProvider` - returns deterministic text from
  ``fixtures/ocr_responses.json`` via the existing
  :class:`services.test_provider.TestProvider`.
"""

from __future__ import annotations

import logging
from typing import Optional

from config import Settings, settings as default_settings
from services.providers.base import (
    OCRProvider,
    OCRProviderOutput,
    OCRRequest,
)
from services.test_provider import TestProvider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Concrete implementations
# ---------------------------------------------------------------------------


class TesseractOCRProvider(OCRProvider):
    """OCR backend that delegates to ``pytesseract``.

    Configuration is passed through on the :class:`OCRRequest` so callers
    can experiment with different PSM/OEM modes without subclassing.
    """

    DEFAULT_CONFIG = "--psm 6 --oem 3"

    def __init__(self, default_config: Optional[str] = None) -> None:
        self.name = "tesseract"
        self._default_config = default_config or self.DEFAULT_CONFIG

    def process(self, request: OCRRequest) -> OCRProviderOutput:
        # pytesseract is imported lazily so the class is usable in tests
        # that stub it via ``conftest``.
        import pytesseract

        config = request.config or self._default_config
        word_data = pytesseract.image_to_data(
            request.image,
            config=config,
            output_type=pytesseract.Output.DICT,
        )

        raw_text_data = word_data.get("text", "")
        if isinstance(raw_text_data, list):
            raw_text = " ".join(str(t) for t in raw_text_data if t)
        elif isinstance(raw_text_data, str):
            raw_text = raw_text_data
        else:
            raw_text = ""

        return OCRProviderOutput(
            raw_text=raw_text,
            processing_time_ms=0,
            word_data=word_data,
        )

    def healthy(self) -> bool:
        # Tesseract itself does not perform liveness checks here - the
        # orchestration layer is responsible for catching downstream
        # errors.  Providers that *can* probe their backend are welcome
        # to override this.
        return True


class FixtureOCRProvider(OCRProvider):
    """Deterministic OCR provider backed by the JSON fixture file.

    No engine installation is required.  The fixture is loaded via the
    shared :class:`services.test_provider.TestProvider` so that fixtures
    stay in one place.
    """

    FIXTURE_ENDPOINT = "ocr"
    DEFAULT_MODEL = "test-provider/fixture"

    def __init__(self, test_provider: Optional[TestProvider] = None) -> None:
        self.name = "fixture"
        self._test_provider = test_provider or TestProvider()

    def process(self, request: OCRRequest) -> OCRProviderOutput:
        # The fixture is keyed by image size so different inputs route to
        # different responses - matches the stable-but-varied behaviour
        # exercised by ``tests/test_test_provider_stability.py``.
        size_marker = "unknown"
        try:
            size_marker = str(request.image.size)
        except Exception:
            size_marker = "unknown"

        fixture = self._test_provider.get_response(
            self.FIXTURE_ENDPOINT,
            {"image_size": size_marker},
        )
        return OCRProviderOutput(
            raw_text=str(fixture.get("raw_text", "") or ""),
            processing_time_ms=int(fixture.get("processing_time_ms", 0) or 0),
            word_data=None,
        )

    def healthy(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Selector
# ---------------------------------------------------------------------------


class OCRProviderSelector:
    """Pick the OCR provider for the current :class:`Settings`.

    Today the choice is binary (``fixture`` when ``test_provider_mode``
    is enabled, otherwise ``tesseract``); introducing cloud OCR APIs
    will not require touching the verification service because the
    selector just decides on a single provider instance.
    """

    def __init__(
        self,
        settings_obj: Settings,
        *,
        override: Optional[str] = None,
    ) -> None:
        self._settings = settings_obj
        self._override = override
        self._cached: Optional[OCRProvider] = None

    @property
    def settings(self) -> Settings:
        return self._settings

    def _select_provider_name(self) -> str:
        if self._override:
            return self._override
        if self._settings.test_provider_mode:
            return "fixture"
        return "tesseract"

    def get(self) -> OCRProvider:
        if self._cached is not None:
            return self._cached
        name = self._select_provider_name()
        if name == "fixture":
            provider: OCRProvider = FixtureOCRProvider()
        elif name == "tesseract":
            provider = TesseractOCRProvider()
        else:
            raise ValueError(f"Unknown OCR provider: {name}")
        self._cached = provider
        return provider


def build_default_ocr_selector(
    settings_obj: Optional[Settings] = None,
) -> OCRProviderSelector:
    """Build the default selector wired against the global settings."""
    return OCRProviderSelector(settings_obj or default_settings)
