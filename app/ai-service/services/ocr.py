import re
from typing import Dict, Optional

from PIL import Image

from services.provider_interface import OCRProvider
from services.provider_types import FieldMatch, OCRResult


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
    def __init__(self, provider: Optional[OCRProvider] = None):
        from services.provider_factory import get_ocr_provider

        self.provider = provider or get_ocr_provider()

    def process_image(self, image: Image.Image) -> OCRResult:
        return self.provider.process_image(image)

    def _run_tesseract(self, image: Image.Image) -> dict:
        # Preserve backwards compatibility for tests and legacy mocks.
        return self.provider._run_tesseract(image)

    def _extract_field_chars(
        self, tesseract_data: dict, field_value: str
    ) -> list[float]:
        return self.provider._extract_field_chars(tesseract_data, field_value)

    def _extract_field_chars(
        self, tesseract_data: dict, field_value: str
    ) -> list[float]:
        confidences = []
        texts = tesseract_data.get("text", [])
        confs = tesseract_data.get("conf", [])

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
