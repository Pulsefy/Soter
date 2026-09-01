import pytest
from dataclasses import dataclass
from config import settings
from services.ocr import FieldDetector, OCRService, FieldMatch, OCRResult
from services.providers import ProviderRegistry, OCRField, OCRResponse, ModelProvider
from services.circuit_breaker import CircuitBreaker
from exceptions import ProviderExhaustedError
from unittest.mock import patch, MagicMock


class TestFieldDetector:
    def setup_method(self):
        self.detector = FieldDetector()

    def test_detect_name(self):
        text = "Name: John Doe"
        fields = self.detector.detect_fields(text)
        assert "name" in fields
        assert fields["name"].value == "John Doe"

    def test_detect_name_with_label_variations(self):
        variations = ["Full Name: Jane Smith", "NAME: Bob Wilson"]
        for text in variations:
            fields = self.detector.detect_fields(text)
            assert "name" in fields, f"Failed for: {text}"

    def test_detect_date_of_birth(self):
        text = "Date of Birth: 15-01-1990"
        fields = self.detector.detect_fields(text)
        assert "date_of_birth" in fields

    def test_detect_dob_with_various_formats(self):
        formats = [
            "DOB: 1990/01/15",
            "Date of Birth: 01.15.1990",
            "DOB: 15 Jan 1990",
        ]
        for text in formats:
            fields = self.detector.detect_fields(text)
            assert "date_of_birth" in fields, f"Failed for: {text}"

    def test_detect_id_number(self):
        text = "ID Number: AB123456"
        fields = self.detector.detect_fields(text)
        assert "id_number" in fields
        assert fields["id_number"].value == "AB123456"

    def test_detect_id_with_various_labels(self):
        variations = [
            "ID: XY987654",
            "Identification: MN111222",
            "Passport No: AA1234567",
        ]
        for text in variations:
            fields = self.detector.detect_fields(text)
            assert "id_number" in fields, f"Failed for: {text}"

    def test_detect_all_fields(self):
        text = """
        Name: John Doe
        Date of Birth: 15 Jan 1990
        ID Number: AB123456
        """
        fields = self.detector.detect_fields(text)
        assert "name" in fields
        assert "date_of_birth" in fields
        assert "id_number" in fields

    def test_detect_no_fields(self):
        text = "This is some random text without identifying information"
        fields = self.detector.detect_fields(text)
        assert len(fields) == 0

    def test_aggregate_confidence(self):
        confidences = [0.9, 0.85, 0.88, 0.92]
        result = self.detector.aggregate_confidence(confidences)
        assert abs(result - 0.8875) < 0.01


class StubOCRProvider(ModelProvider):
    """Minimal OCR provider for testing."""

    def __init__(self, response):
        self._response = response
        self._call_count = 0

    @property
    def name(self):
        return "stub"

    def ocr_extract(self, image, *, language_hint=None):
        self._call_count += 1
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class TestOCRService:
    def setup_method(self):
        self.ocr = OCRService()

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_returns_result(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        from PIL import Image

        stub_response = OCRResponse(
            fields={
                "name": OCRField(value="John Doe", confidence=0.92),
                "id_number": OCRField(value="AB123456", confidence=0.95),
            },
            raw_text="Name: John Doe ID AB123456",
            processing_time_ms=100,
            provider="stub",
        )
        stub_provider = StubOCRProvider(stub_response)

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("stub", stub_provider)]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img)
        assert isinstance(result, OCRResult)
        assert isinstance(result.fields, dict)
        assert isinstance(result.raw_text, str)
        assert result.processing_time_ms >= 0

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_passes_language_hint(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        from PIL import Image

        captured_hints = []

        class HintCapturingProvider(ModelProvider):
            @property
            def name(self):
                return "hint_capture"

            def ocr_extract(self, image, *, language_hint=None):
                captured_hints.append(language_hint)
                return OCRResponse(
                    fields={"name": OCRField(value="Jane", confidence=0.9)},
                    raw_text="Name: Jane",
                    processing_time_ms=50,
                    provider="hint_capture",
                )

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [
            ("hint_capture", HintCapturingProvider())
        ]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img, language_hint="fra")

        assert captured_hints == ["fra"]
        assert result.raw_text == "Name: Jane"

    def test_process_image_empty_image(self, monkeypatch):
        from PIL import Image

        # Use the fixture provider so the test does not depend on a real OCR
        # engine being available; it still exercises the degenerate-image path
        # through the full service without exhausting providers.
        monkeypatch.setattr(settings, "test_provider_mode", True)

        img = Image.new("RGB", (0, 0), color="white")
        result = self.ocr.process_image(img)
        assert isinstance(result, OCRResult)

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_records_serving_provider(self, mock_labels, monkeypatch):
        from PIL import Image

        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        stub_response = OCRResponse(
            fields={"name": OCRField(value="John", confidence=0.9)},
            raw_text="Name: John",
            processing_time_ms=10,
            provider="tesseract",
        )
        stub_provider = StubOCRProvider(stub_response)
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("tesseract", stub_provider)]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img)
        assert result.provider == "tesseract"

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_skips_open_circuit_provider(self, mock_labels, monkeypatch):
        from PIL import Image

        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        tesseract = StubOCRProvider(
            OCRResponse(
                fields={}, raw_text="", processing_time_ms=1, provider="tesseract"
            )
        )
        fallback = StubOCRProvider(
            OCRResponse(
                fields={"name": OCRField(value="Jane", confidence=0.9)},
                raw_text="Name: Jane",
                processing_time_ms=1,
                provider="test",
            )
        )
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [
            ("tesseract", tesseract),
            ("test", fallback),
        ]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        breaker = CircuitBreaker(name="tesseract", failure_threshold=1)
        breaker.record_failure()
        self.ocr.breakers["tesseract"] = breaker

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img)
        assert result.provider == "test"
        # tesseract was skipped because its circuit is OPEN
        assert tesseract._call_count == 0

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_exhaustion_raises_distinct_error(
        self, mock_labels, monkeypatch
    ):
        from PIL import Image

        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        failing = StubOCRProvider(RuntimeError("ocr boom"))
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("tesseract", failing)]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (200, 100), color="white")
        with pytest.raises(ProviderExhaustedError) as excinfo:
            self.ocr.process_image(img)
        assert excinfo.value.code == "AI_PROVIDERS_EXHAUSTED"
        assert excinfo.value.details["attempted"]


class TestOCRResult:
    def test_create_ocr_result(self):
        fields = {"name": FieldMatch(value="Test", confidence=0.9)}
        result = OCRResult(fields=fields, raw_text="Name: Test", processing_time_ms=100)
        assert result.fields["name"].value == "Test"
        assert result.processing_time_ms == 100


class TestFieldMatch:
    def test_create_field_match(self):
        fm = FieldMatch(value="John Doe", confidence=0.91)
        assert fm.value == "John Doe"
        assert fm.confidence == 0.91
