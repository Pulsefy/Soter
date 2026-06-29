"""OCR service that orchestrates preprocessing + provider + field detection.

The OCR service still owns the preprocessing pipeline and the regular
expression based field detection - both are policy decisions that
belong to the Soter pipeline rather than to any single OCR engine.
The actual model invocation is delegated to an :class:`OCRProvider`
resolved through an :class:`OCRProviderSelector`.

This split lets Soter swap OCR backends (Tesseract today, a different
engine or a fixture for tests tomorrow) without touching the route
handlers or the field-detection rules.
"""

import logging
import re
import time
from dataclasses import dataclass
from typing import Optional

from PIL import Image

import metrics
from config import settings
from services.preprocessing import ImagePreprocessor
from services.providers import (
    OCRProvider,
    OCRProviderSelector,
    OCRRequest,
    build_default_ocr_selector,
)

logger = logging.getLogger(__name__)


@dataclass
class FieldMatch:
    value: str
    confidence: float


@dataclass
class OCRResult:
    fields: dict
    raw_text: str
    processing_time_ms: int


class FieldDetector:
    PATTERNS = {
        "name": [
            r"(?:Full\s+)?[Nn]ame[:\s]+\n?([A-Z][a-z]+(?:[ \t]+(?!(?i:Date|DOB|Birth|ID|Passport|Sex))\b[A-Z][a-z]+)*)",
            r"(?:Full\s+)?[Nn]ame[:\s]+\n?([A-Z]+(?:[ \t]+(?!(?i:DATE|DOB|BIRTH|ID|PASSPORT|SEX))\b[A-Z]+)*)",
        ],
        "date_of_birth": [
            r"[Dd]ate\s+(?:of\s+)?[Bb]irth[:\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd]ate\s+(?:of\s+)?[Bb]irth[:\s]*(\d{4}[-./]\d{2}[-./]\d{2})",
            r"[Dd][Oo][Bb][:?\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd][Oo][Bb][:?\s]*(\d{4}[-./]\d{2}[-./]\d{2})",
            r"[Bb]irth\s*[Dd]ate[:\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd]ate\s+(?:of\s+)?[Bb]irth[:\s\n]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
            r"[Dd][Oo][Bb][:?\s\n]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
            r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
        ],
        "id_number": [
            r"[Ii][Dd]\s+[Nn]umber[:\s]+([A-Z0-9]{6,12})\b",
            r"[Ii][Dd][:?\s]+([A-Z0-9]{6,12})\b",
            r"[Ii][Dd](?:entification)?[:\s]+([A-Z0-9]{6,12})\b",
            r"[Pp]assport\s*[Nn]o[:\s]+([A-Z0-9]{6,12})\b",
            r"[Nn][Ii][Dd][:?\s]+([A-Z0-9]{6,12})\b",
        ],
    }

    def detect_fields(self, text: str) -> dict:
        if not isinstance(text, str):
            text = str(text) if text else ""
        text = text.strip()
        if not text:
            return {}

        fields = {}

        for field_name, patterns in self.PATTERNS.items():
            for pattern in patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    fields[field_name] = FieldMatch(
                        value=match.group(1).strip(),
                        confidence=0.8,
                    )
                    break

        return fields

    def aggregate_confidence(self, char_confidences):
        if not char_confidences:
            return 0.0
        return sum(char_confidences) / len(char_confidences)


class OCRService:
    """Pipeline orchestrator. Delegates the actual OCR call to a provider."""

    def __init__(
        self,
        provider_selector: Optional[OCRProviderSelector] = None,
        field_detector: Optional[FieldDetector] = None,
        preprocessor: Optional[ImagePreprocessor] = None,
        provider_override: Optional[OCRProvider] = None,
    ):
        self.preprocessor = preprocessor or ImagePreprocessor()
        self.field_detector = field_detector or FieldDetector()
        self._provider_selector = provider_selector or build_default_ocr_selector()
        self._provider_override = provider_override
        # Legacy attribute preserved for tests that access
        # ``OCRService.test_provider`` directly (see
        # ``tests/test_test_provider_stability.py``).
        from services.test_provider import TestProvider

        self.test_provider = TestProvider()

    # ------------------------------------------------------------------
    # Provider resolution
    # ------------------------------------------------------------------

    @property
    def provider(self) -> OCRProvider:
        if self._provider_override is not None:
            return self._provider_override
        return self._provider_selector.get()

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    def process_image(self, image: Image.Image) -> OCRResult:
        start_time = time.time()

        preprocessed = self.preprocessor.preprocess(
            image, threshold_method="otsu", denoise=True
        )

        if preprocessed.size[0] == 0 or preprocessed.size[1] == 0:
            return OCRResult(
                fields={},
                raw_text="",
                processing_time_ms=int((time.time() - start_time) * 1000),
            )

        # Routing through ``_run_tesseract`` (the legacy hook) keeps
        # the existing test contract intact - ``tests/test_ocr.py``
        # monkeypatches that method directly, and the production
        # implementation delegates to the underlying
        # :class:`OCRProvider` selected by the selector.
        word_data = self._run_tesseract(preprocessed)

        raw_text_data = word_data.get("text", "") if isinstance(word_data, dict) else ""
        if isinstance(raw_text_data, list):
            raw_text = " ".join(str(t) for t in raw_text_data if t)
        elif isinstance(raw_text_data, str):
            raw_text = raw_text_data
        else:
            raw_text = str(raw_text_data) if raw_text_data else ""

        provider_output = OCRProviderOutput(
            raw_text=raw_text,
            processing_time_ms=int((time.time() - start_time) * 1000),
            word_data=word_data if isinstance(word_data, dict) else None,
        )

        fields = self.field_detector.detect_fields(raw_text)
        for field_name, field_match in fields.items():
            field_chars = self._extract_field_chars(
                provider_output, field_match.value
            )
            field_match.confidence = self.field_detector.aggregate_confidence(
                field_chars
            )

        latency = time.time() - start_time
        metrics.PIPELINE_STEP_LATENCY.labels(step_name="ocr").observe(latency)

        return OCRResult(
            fields=fields,
            raw_text=raw_text,
            processing_time_ms=int(latency * 1000),
        )

    # ------------------------------------------------------------------
    # Provider adapter hooks (kept stable for tests that monkeypatch them)
    # ------------------------------------------------------------------

    def _run_provider(self, provider: OCRProvider, image: Image.Image):
        """Dispatch an OCR call through the provider abstraction.

        Retained for tests that prefer mocking at the provider layer
        rather than the legacy ``_run_tesseract`` hook.
        """
        return provider.process(OCRRequest(image=image))

    def _run_tesseract(self, image: Image.Image) -> dict:
        """Legacy hook used by ``tests/test_ocr.py``.

        In production this delegates to the active :class:`OCRProvider`
        and converts the result into the pytesseract-style ``word_data``
        dict the legacy callers expect (``text`` and ``conf`` lists).
        Tests that monkeypatch this method directly bypass the provider
        pipeline entirely, which is the historical contract.
        """
        provider = self.provider
        provider_output = provider.process(OCRRequest(image=image))
        if isinstance(provider, TesseractOCRProvider):
            return provider_output.word_data or {
                "text": provider_output.raw_text,
                "conf": [],
            }
        return {
            "text": provider_output.raw_text,
            "conf": [],
        }

    def _extract_field_chars(self, provider_output, field_value: str):
        """Locate confidences for the field's characters in the provider output.

        Falls back to ``[0.8]`` when the provider does not expose
        per-character confidence - matches the pre-abstraction default.
        """
        # 1. Prefer explicit char_confidences (fixture providers with
        #    granularity below word-level).
        if getattr(provider_output, "char_confidences", None):
            return list(provider_output.char_confidences)

        word_data = provider_output.word_data
        if not word_data:
            return [0.8]

        confidences: list = []
        texts = word_data.get("text", [])
        confs = word_data.get("conf", [])

        if isinstance(texts, str):
            texts = [texts]
        if isinstance(confs, (int, float)):
            confs = [confs]

        for i, text in enumerate(texts):
            if field_value.lower() in str(text).lower():
                if i < len(confs):
                    try:
                        conf = float(confs[i])
                        if conf > 0:
                            confidences.append(conf / 100.0)
                    except (ValueError, TypeError):
                        pass

        return confidences if confidences else [0.8]
