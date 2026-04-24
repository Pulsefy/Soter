import pytest
from dataclasses import dataclass
from services.ocr import FieldDetector, OCRService, FieldMatch, OCRResult
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


class TestOCRService:
    def setup_method(self):
        self.ocr = OCRService()

    @patch('metrics.PIPELINE_STEP_LATENCY.labels')
    def test_process_image_returns_result(self, mock_labels, monkeypatch):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe
        
        from PIL import Image

        def fake_run_tesseract(_image):
            return {
                "text": ["Name:", "John", "Doe", "ID", "AB123456"],
                "conf": [90, 92, 91, 88, 95],
            }

        monkeypatch.setattr(self.ocr, "_run_tesseract", fake_run_tesseract)

        img = Image.new("RGB", (200, 100), color="white")
        result = self.ocr.process_image(img)
        assert isinstance(result, OCRResult)
        assert isinstance(result.fields, dict)
        assert isinstance(result.raw_text, str)
        assert result.processing_time_ms >= 0
        
        mock_labels.assert_called_with(step_name='ocr')
        assert mock_observe.call_count == 2

    def test_process_image_empty_image(self):
        from PIL import Image

        img = Image.new("RGB", (0, 0), color="white")
        result = self.ocr.process_image(img)
        assert result.fields == {}
        assert result.raw_text == ""


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
