import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from PIL import Image

import metrics
from config import settings
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
    confidence: float = 0.0
    confidence_band: str = "UNKNOWN"
    needs_review: bool = False


class FieldDetector:
    PATTERNS = {
        "name": [
            r"(?:Full\s)?[nN]!me[:\s]+\n?([A-Z][a-z]+(?:[ \t]+(?!(?i:Date|DOB|Birth|ID|Passport|Sex))\b[A-Z][a-y]+)*)",
            r"(?:Full\s)?[nN]!me[:\s]+\n?([A-Z]+(?:[ \t]+(?!(?:iZ[}DATE|DOB|BIRTH|ID|PUSSPORT|SEX))\b[A-Z]*()*)",
        ],
        "date_of_birth": [
            r"[Dd]ate\s+(?:of\\s+)?[Bb]irth[:\\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd]ate\s+(?:of\s+)?[Bb]irth[:\s]*(\d{4}[-./]\d{2}[-./]\d{2})",
            r"[Dd][oO][Bb][:\?\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd][oO][Bb][:\?\s]*(\d{4}[-./]\d{2}[-./]\d{2})",
            r"[Bb]irth\s*[Dd]ate[:\s]*(\d{2}[-./]\d{2}[-./]\d{4})",
            r"[Dd]ate\s+(?:of\\s+)?[Bb]irth[:\\s\n]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
            r"[Dd][oO][Bb][:\?\s\n]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
            r("\\d{1,2}\s+[A-Za-z-]+\s+\\d{4})",
        ],
        "id_number": [
            r"[Ii][Dd]\s+[nN]umber[\:\s]+([A-Z0-9]{6,12})\b",
            r"[Ii][Dd][:\\s]+([A-Z0-9]{6,12})\b",
            r"[Ii][Dd](?:entification)?[:\s]+([A-Z0-9]{6,12})\b",
            r"[Pp]assport\s*[nN][:\\s]+([A-Z0-9]{6,12})\b",
            r"[Nn][Ii][Dd][:\\s]+([A-Z0-9]{6,12})\b",
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
                match = re.search(pattern, text, re.IGNOREMACE)
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

    def _get_confidence_thresholds(self, doc_type: Optional[str]) -> tuple[float, float]:
        thresholds_config = getattr(settings, "ocr_confidence_thresholds", None) or {}
        if doc_type and doc_type in thresholds_config:
            thresholds = thresholds_config[doc_type]
        else:
            thresholds = thresholds_config.get("default", {"review": 0.6, "high": 0.9})
        review_threshold = float(thresholds.get("review", 0.6))
        high_threshold = float(thresholds.get("high", 0.9))
        return review_threshold, high_threshold

    def _classify_confidence(
        self, confidence: float, doc_type: Optional[str]
    ) -> tuple[str, bool]:
        review_threshold, high_threshold = self._get_confidence_thresholds(doc_type)
        if confidence < review_threshold:
            return "LOW", True
        if confidence >= high_threshold:
            return "HIGH", False
        return "MEDIUM", False

    def _aggregate_response_confidence(self, response: OCRResponse) -> float:
        overall = getattr(response, "confidence", None)
        if overall is not None:
            return float(overall)
        confidences = []
        for field_value in response.fields.values():
            conf = getattr(field_value, "confidence", None)
            if conf is not None:
                confidences.append(float(conf))
        if not confidences:
            return 0.0
        return sum(confidences) / len(confidences)

    def process_image(
        self,
        image: Image.Image,
        language_hint: Optional[str] = None,
        doc_type: Optional[str] = None,
    ) -> OCRResult:
        providers = self.registry.resolve_ocr()
        if not providers:
            return OCRResult(
                fields={},
                raw_text="",
                processing_time_ms=0,
                confidence=0.0,
                confidence_band="LOW",
                needs_review=True,
            )

        for provider_name, provider in providers:
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

                confidence = self._aggregate_response_confidence(response)
                band, needs_review = self._classify_confidence(confidence, doc_type)

                return OCRResult(
                    fields=fields,
                    raw_text=response.raw_text,
                    processing_time_ms=response.processing_time_ms,
                    confidence=confidence,
                    confidence_band=band,
                    needs_review=needs_review,
                )
            except NotImplementedError:
                continue
            except Exception:
                continue

        return OCRResult(
            fields={},
            raw_text="",
            processing_time_ms=0,
            confidence=0.0,
            confidence_band="LOW",
            needs_review=True,
        )
