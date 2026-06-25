import re
import time
from dataclasses import dataclass, field
from typing import Dict

import pytesseract
from PIL import Image

import metrics
from config import settings
from services.preprocessing import ImagePreprocessor
from services.test_provider import TestProvider


@dataclass
class FieldMatch:
    value: str
    confidence: float


@dataclass
class OCRResult:
    fields: dict[str, FieldMatch]
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
    def __init__(self):
        self.preprocessor = ImagePreprocessor()
        self.field_detector = FieldDetector()
        self.test_provider = TestProvider()

    def process_image(self, image: Image.Image) -> OCRResult:
        if settings.test_provider_mode:
            response = self.test_provider.get_response("ocr", {"image_size": str(image.size)})
            fields: Dict[str, FieldMatch] = {}
            for name, fdata in response.get("fields", {}).items():
                fields[name] = FieldMatch(value=fdata["value"], confidence=fdata["confidence"])
            return OCRResult(
                fields=fields,
                raw_text=response.get("raw_text", ""),
                processing_time_ms=response.get("processing_time_ms", 0),
            )

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

        tesseract_data = self._run_tesseract(preprocessed)

        raw_text = tesseract_data.get("text", "")
        if isinstance(raw_text, list):
            raw_text = " ".join(str(t) for t in raw_text if t)
        raw_text = str(raw_text) if raw_text else ""

        fields = self.field_detector.detect_fields(raw_text)

        for field_name, field_match in fields.items():
            field_chars = self._extract_field_chars(tesseract_data, field_match.value)
            field_match.confidence = self.field_detector.aggregate_confidence(
                field_chars
            )

        latency = time.time() - start_time
        metrics.PIPELINE_STEP_LATENCY.labels(step_name='ocr').observe(latency)

        return OCRResult(
            fields=fields,
            raw_text=raw_text,
            processing_time_ms=int(latency * 1000),
        )

    def _run_tesseract(self, image: Image.Image) -> dict:
        config = "--psm 6 --oem 3"
        data = pytesseract.image_to_data(
            image, config=config, output_type=pytesseract.Output.DICT
        )
        return data

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
