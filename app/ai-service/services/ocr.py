import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from PIL import Image

import metrics
from config import settings

logger = logging.getLogger(__name__)
from exceptions import ProviderExhaustedError
from services.circuit_breaker import CircuitBreaker
from services.preprocessing import ImagePreprocessor
from services.providers import ProviderRegistry, OCRField, OCRResponse


@dataclass
class FieldMatch:
    value: str
    confidence: float


@dataclass
class OCRResult:
    fields: dict[str, FieldMatch]
    raw_text: str
    processing_time_ms: int
    provider: Optional[str] = None


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
            r"[Ii][Dd][:\s]+([A-Z0-9]{6,12})\b",
            r"[Ii][Dd](?:entification)?[:\s]+([A-Z0-9]{6,12})\b",
            r"[Pp]assport\s*[Nn]o[:\s]+([A-Z0-9]{6,12})\b",
            r"[Nn][Ii][Dd][:\s]+([A-Z0-9]{6,12})\b",
        ],
    }

    def detect_fields(self, text: str) -> dict[str, FieldMatch]:
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

    def aggregate_confidence(self, char_confidences: list[float]) -> float:
        if not char_confidences:
            return 0.0
        return sum(char_confidences) / len(char_confidences)


class OCRService:
    def __init__(self, registry: Optional[ProviderRegistry] = None):
        self.preprocessor = ImagePreprocessor()
        self.field_detector = FieldDetector()
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

    def process_image(
        self, image: Image.Image, language_hint: Optional[str] = None
    ) -> OCRResult:
        providers = self.registry.resolve_ocr()
        if not providers:
            return OCRResult(fields={}, raw_text="", processing_time_ms=0)

        errors: List[str] = []
        for provider_name, provider in providers:
            breaker = self._get_breaker(provider_name)
            if not breaker.allow_request():
                logger.warning(
                    "Circuit breaker is OPEN for provider=%s. Skipping.", provider_name
                )
                errors.append(
                    f"provider={provider_name}, error=Circuit breaker is OPEN"
                )
                continue
            try:
                response: OCRResponse = provider.ocr_extract(
                    image, language_hint=language_hint
                )
                fields: Dict[str, FieldMatch] = {}
                for fname, ocr_field in response.fields.items():
                    fields[fname] = FieldMatch(
                        value=ocr_field.value, confidence=ocr_field.confidence
                    )

                metrics.PIPELINE_STEP_LATENCY.labels(step_name="ocr").observe(
                    response.processing_time_ms / 1000.0
                )

                breaker.record_success()
                return OCRResult(
                    fields=fields,
                    raw_text=response.raw_text,
                    processing_time_ms=response.processing_time_ms,
                    provider=provider_name,
                )
            except NotImplementedError:
                continue
            except Exception as exc:
                breaker.record_failure()
                err = f"provider={provider_name}, error={exc}"
                errors.append(err)
                logger.warning("OCR attempt failed: %s", err)
                continue

        raise ProviderExhaustedError(
            "All OCR providers were attempted and exhausted: " + " | ".join(errors),
            details={"attempted": errors},
        )
