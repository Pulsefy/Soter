import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

from PIL import Image

import metrics
from config import settings
from exceptions import ProviderExhaustedError
from services.circuit_breaker import CircuitBreaker
from services.preprocessing import ImagePreprocessor
from services.providers import ProviderRegistry, OCRResponse

logger = logging.getLogger(__name__)


class ConfidenceBanding(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


@dataclass
class FieldMatch:
    value: str
    confidence: float


@dataclass
class OCRResult:
    fields: dict[str, FieldMatch]
    raw_text: str
    processing_time_ms: int
    confidence: Optional[float] = None
    confidence_banding: str = ConfidenceBanding.UNKNOWN.value
    requires_review: bool = False
    review_reasons: List[str] = field(default_factory=list)
    document_type: Optional[str] = None
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

    @classmethod
    def evaluate_confidence(
        cls,
        fields: Dict[str, FieldMatch],
        raw_text: str = "",
        document_type: Optional[str] = None,
        threshold: Optional[float] = None,
    ) -> Tuple[Optional[float], str, bool, List[str]]:
        '''
        Evaluate aggregate confidence and determine if the extraction requires manual review.

        Args:
            fields: Detected field matches with individual confidences.
            raw_text: Full raw text from OCR.
            document_type: Optional document type name (e.g. 'id_card', 'passport').
            threshold: Optional explicit threshold override.

        Returns:
            Tuple of (confidence, confidence_banding, requires_review, review_reasons).
        '''
        doc_threshold = (
            threshold
            if threshold is not None
            else settings.get_ocr_threshold(document_type)
        )

        field_confidences = [
            f.confidence
            for f in fields.values()
            if isinstance(f.confidence, (int, float))
        ]

        if not field_confidences:
            return (
                None,
                ConfidenceBanding.UNKNOWN.value,
                True,
                ["Missing confidence score; manual review required"],
            )

        avg_confidence = round(sum(field_confidences) / len(field_confidences), 4)

        if avg_confidence < doc_threshold:
            doc_label = f" for document type '{document_type}'" if document_type else ""
            reason = (
                f"Confidence {avg_confidence:.4f} is below threshold "
                f"{doc_threshold:.4f}{doc_label}; manual review required"
            )
            return (
                avg_confidence,
                ConfidenceBanding.LOW.value,
                True,
                [reason],
            )

        if avg_confidence >= 0.85:
            banding = ConfidenceBanding.HIGH.value
        else:
            banding = ConfidenceBanding.MEDIUM.value

        return (
            avg_confidence,
            banding,
            False,
            [],
        )

    def process_image(
        self,
        image: Image.Image,
        language_hint: Optional[str] = None,
        document_type: Optional[str] = None,
    ) -> OCRResult:
        providers = self.registry.resolve_ocr()
        if not providers:
            raise ProviderExhaustedError("No OCR providers available")

        errors: List[str] = []
        if (
            image is None
            or image.width == 0
            or image.height == 0
            or image.getbbox() is None
            or image.convert("L").getextrema()[0]
            == image.convert("L").getextrema()[1]
        ):
            conf, banding, req_review, reasons = self.evaluate_confidence(
                fields={}, raw_text="", document_type=document_type
            )
            return OCRResult(
                fields={},
                raw_text="",
                processing_time_ms=0,
                confidence=conf,
                confidence_banding=banding,
                requires_review=req_review,
                review_reasons=reasons,
                document_type=document_type,
            )

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
                conf, banding, req_review, reasons = self.evaluate_confidence(
                    fields=fields,
                    raw_text=response.raw_text,
                    document_type=document_type,
                )

                return OCRResult(
                    fields=fields,
                    raw_text=response.raw_text,
                    processing_time_ms=response.processing_time_ms,
                    confidence=conf,
                    confidence_banding=banding,
                    requires_review=req_review,
                    review_reasons=reasons,
                    document_type=document_type,
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

        raise ProviderExhaustedError("All OCR providers failed")