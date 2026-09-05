import pytest
from config import settings
from services.ocr import (
    FieldDetector,
    OCRService,
    FieldMatch,
    OCRResult,
    ConfidenceBanding,
)
from services.providers import ProviderRegistry, OCRField, OCRResponse, ModelProvider
from services.circuit_breaker import CircuitBreaker
from exceptions import ProviderExhaustedError
from unittest.mock import patch, MagicMock
from PIL import Image


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


class TestOCRConfidenceEvaluation:
    def test_confidence_above_threshold_high_banding(self):
        fields = {
            "name": FieldMatch(value="Alice", confidence=0.92),
            "id_number": FieldMatch(value="A123456", confidence=0.90),
        }
        conf, banding, req_review, reasons = OCRService.evaluate_confidence(fields)

        assert conf == 0.91
        assert banding == ConfidenceBanding.HIGH.value
        assert req_review is False
        assert reasons == []

    def test_confidence_above_threshold_medium_banding(self):
        # Default threshold is 0.75; 0.78 is >= 0.75 and < 0.85 -> MEDIUM
        fields = {
            "name": FieldMatch(value="Bob", confidence=0.76),
            "id_number": FieldMatch(value="B123456", confidence=0.80),
        }
        conf, banding, req_review, reasons = OCRService.evaluate_confidence(fields)

        assert conf == 0.78
        assert banding == ConfidenceBanding.MEDIUM.value
        assert req_review is False
        assert reasons == []

    def test_confidence_below_threshold_flags_review(self):
        # Default threshold is 0.75; 0.60 is < 0.75 -> LOW and requires_review
        fields = {
            "name": FieldMatch(value="Charlie", confidence=0.55),
            "id_number": FieldMatch(value="C123456", confidence=0.65),
        }
        conf, banding, req_review, reasons = OCRService.evaluate_confidence(fields)

        assert conf == 0.60
        assert banding == ConfidenceBanding.LOW.value
        assert req_review is True
        assert len(reasons) == 1
        assert "below threshold" in reasons[0]
        assert "manual review required" in reasons[0]

    def test_missing_confidence_flags_review(self):
        fields = {}
        conf, banding, req_review, reasons = OCRService.evaluate_confidence(fields)

        assert conf is None
        assert banding == ConfidenceBanding.UNKNOWN.value
        assert req_review is True
        assert len(reasons) == 1
        assert "Missing confidence score" in reasons[0]

    def test_document_type_threshold_overrides_id_card(self):
        # id_card threshold defaults to 0.85
        fields = {
            "name": FieldMatch(value="David", confidence=0.80),
            "id_number": FieldMatch(value="D123456", confidence=0.80),
        }

        # For default (0.75), 0.80 is passing
        conf_def, banding_def, req_def, _ = OCRService.evaluate_confidence(fields)
        assert req_def is False
        assert banding_def == ConfidenceBanding.MEDIUM.value

        # For id_card (0.85), 0.80 is below threshold -> requires review
        conf_id, banding_id, req_id, reasons_id = OCRService.evaluate_confidence(
            fields, document_type="id_card"
        )
        assert conf_id == 0.80
        assert req_id is True
        assert banding_id == ConfidenceBanding.LOW.value
        assert "for document type 'id_card'" in reasons_id[0]

    def test_document_type_threshold_overrides_receipt(self):
        # receipt threshold defaults to 0.70
        fields = {
            "total": FieldMatch(value="$100", confidence=0.72),
        }

        # For receipt (0.70), 0.72 is passing
        conf, banding, req, _ = OCRService.evaluate_confidence(
            fields, document_type="receipt"
        )
        assert conf == 0.72
        assert req is False
        assert banding == ConfidenceBanding.MEDIUM.value

    def test_explicit_threshold_override(self):
        fields = {"name": FieldMatch(value="Eve", confidence=0.88)}

        # Passing threshold=0.90 should override config and flag as low
        conf, banding, req, reasons = OCRService.evaluate_confidence(
            fields, threshold=0.90
        )
        assert conf == 0.88
        assert req is True
        assert banding == ConfidenceBanding.LOW.value
        assert "below threshold 0.9000" in reasons[0]


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
    def test_process_image_returns_result_with_confidence_and_banding(
        self, mock_labels, monkeypatch
    ):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observeabels.return_value.observe = mock_observe

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
        assert result.confidence == 0.935
        assert result.confidence_banding == "HIGH"
        assert result.requires_review is False
        assert result.review_reasons == []

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_flags_low_confidence_for_review(
        self, mock_labels, monkeypatch
    ):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        stub_response = OCRResponse(
            fields={
                "name": OCRField(value="Blurry Name", confidence=0.45),
            },
            raw_text="Name: Blurry Name",
            processing_time_ms=100,
            provider="stub",
        )
        stub_provider = StubOCRProvider(stub_response)

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("stub", stub_provider)]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img, document_type="id_card")

        assert result.confidence == 0.45
        assert result.confidence_banding == "LOW"
        assert result.requires_review is True
        assert result.document_type == "id_card"
        assert len(result.review_reasons) > 0

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_process_image_passes_language_hint(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

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
        assert result.confidence == 0.9
        assert result.confidence_banding == "HIGH"
        assert result.requires_review is False

    def test_process_image_empty_image(self, monkeypatch):
        from PIL import Image

        monkeypatch.setattr(settings, "test_provider_mode", False)

        stub_response = OCRResponse(
            fields={}, raw_text="", processing_time_ms=0, provider="stub"
        )
        stub_provider = StubOCRProvider(stub_response)
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("stub", stub_provider)]
        monkeypatch.setattr(self.ocr, "registry", mock_registry)

        img = Image.new("RGB", (0, 0), color="white")
        result = self.ocr.process_image(img)
        assert isinstance(result, OCRResult)
        assert result.confidence is None
        assert result.confidence_banding == "UNKNOWN"
        assert result.requires_review is True

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

        monkeypatch.setattr(settings, "test_provider_mode", False)

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
        result = OCRResult(
            fields=fields,
            raw_text="Name: Test",
            processing_time_ms=100,
            confidence=0.9,
            confidence_banding="HIGH",
            requires_review=False,
            review_reasons=[],
            document_type="passport",
        )
        assert result.fields["name"].value == "Test"
        assert result.processing_time_ms == 100
        assert result.confidence == 0.9
        assert result.confidence_banding == "HIGH"
        assert result.requires_review is False
        assert result.document_type == "passport"


class TestFieldMatch:
    def test_create_field_match(self):
        fm = FieldMatch(value="John Doe", confidence=0.91)
        assert fm.value == "John Doe"
        assert fm.confidence == 0.91