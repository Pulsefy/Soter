"""
Tests for structured field-level redaction of OCR output (issue #1207).

Coverage
--------
* StructuredRedactionService redacts distinct field types (name, identity
  number, date, ...) according to each field's known type.
* The /v1/ai/redaction/preview/structured endpoint previews structured OCR
  redaction without echoing raw field values.
* OCR responses support field-level redaction driven by field type while
  leaving the default (non-redacted) behavior unchanged.
"""

import io
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

import main
import metrics
from main import app
from services.ocr import FieldMatch, OCRResult
from services.structured_redaction import StructuredRedactionService

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    """Mirror test_versioned_routes.py: throttle only when resources checked."""
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


class TestStructuredRedactionService:
    def setup_method(self):
        self.service = StructuredRedactionService()

    def test_maps_three_distinct_field_types(self):
        """AC: at least three distinct structured field types are handled."""
        fields = {
            "full_name": "Aisha Bello",
            "national_id": "12345678901",
            "date_of_birth": "1990-01-15",
        }
        redacted = self.service.redact_fields(fields)

        assert redacted["full_name"] == "[RECIPIENT_NAME]"
        assert redacted["national_id"] == "[ID_NUMBER]"
        assert redacted["date_of_birth"] == "[EVENT_DATE]"
        # Raw values never survive redaction.
        assert "Aisha Bello" not in redacted.values()
        assert "12345678901" not in redacted.values()

    def test_redacts_differently_by_field_type(self):
        """A national_id is redacted differently from a full_name field."""
        redacted = self.service.redact_fields(
            {"full_name": "Kim Park", "national_id": "AA98765432"}
        )
        assert redacted["full_name"] == "[RECIPIENT_NAME]"
        assert redacted["national_id"] == "[ID_NUMBER]"
        assert redacted["full_name"] != redacted["national_id"]

    def test_category_lookup_is_case_insensitive(self):
        assert self.service.category_for_field("National_ID") == "ID"
        assert self.service.category_for_field("FULL_NAME") == "PERSON"
        assert self.service.category_for_field("DateOfBirth") == "DATE"

    def test_unknown_field_is_left_unchanged(self):
        fields = {"field_not_known": "some value", "full_name": "Kim Park"}
        redacted = self.service.redact_fields(fields)
        assert redacted["field_not_known"] == "some value"
        assert redacted["full_name"] == "[RECIPIENT_NAME]"

    def test_build_preview_shape(self):
        preview = self.service.build_preview(
            {"full_name": "Aisha Bello", "notes": "ok", "dob": "1990-01-15"}
        )
        assert preview["total_fields"] == 3
        assert preview["redacted_fields"] == 2
        assert preview["fields"]["full_name"]["category"] == "PERSON"
        assert preview["fields"]["full_name"]["redacted"] is True
        assert preview["fields"]["full_name"]["masked_value"] == "[RECIPIENT_NAME]"
        assert preview["fields"]["notes"]["redacted"] is False
        assert preview["fields"]["notes"]["masked_value"] is None
        assert preview["pii_summary"] == {"PERSON": 1, "DATE": 1}

    def test_empty_fields(self):
        assert self.service.redact_fields({}) == {}
        preview = self.service.build_preview({})
        assert preview["total_fields"] == 0
        assert preview["redacted_fields"] == 0


class TestOCRServiceRedactFields:
    def test_ocr_service_redacts_field_values(self):
        from services.ocr import OCRService

        ocr = OCRService()
        fields = {
            "full_name": FieldMatch(value="Aisha Bello", confidence=0.95),
            "national_id": FieldMatch(value="12345678901", confidence=0.92),
            "date_of_birth": FieldMatch(value="1990-01-15", confidence=0.90),
        }
        redacted = ocr.redact_fields(fields)

        assert redacted["full_name"].value == "[RECIPIENT_NAME]"
        assert redacted["national_id"].value == "[ID_NUMBER]"
        assert redacted["date_of_birth"].value == "[EVENT_DATE]"
        # Confidence is preserved alongside the masked value.
        assert redacted["full_name"].confidence == 0.95


class TestStructuredRedactionPreviewRoute:
    def test_preview_endpoint_returns_structured_result(self):
        response = client.post(
            "/v1/ai/redaction/preview/structured",
            json={
                "fields": {
                    "full_name": "Aisha Bello",
                    "national_id": "12345678901",
                    "date_of_birth": "1990-01-15",
                }
            },
        )
        assert response.status_code == 200
        body = response.json()
        result = body["result"]

        assert result["total_fields"] == 3
        assert result["redacted_fields"] == 3
        assert result["fields"]["full_name"]["category"] == "PERSON"
        assert result["fields"]["full_name"]["masked_value"] == "[RECIPIENT_NAME]"
        assert result["fields"]["national_id"]["category"] == "ID"
        assert result["fields"]["national_id"]["masked_value"] == "[ID_NUMBER]"
        assert result["fields"]["date_of_birth"]["category"] == "DATE"
        assert result["fields"]["date_of_birth"]["masked_value"] == "[EVENT_DATE]"
        assert result["pii_summary"] == {"PERSON": 1, "ID": 1, "DATE": 1}

    def test_preview_endpoint_does_not_echo_raw_values(self):
        raw_value = "Sensitive Name X 2201"
        response = client.post(
            "/v1/ai/redaction/preview/structured",
            json={"fields": {"full_name": raw_value}},
        )
        assert response.status_code == 200
        assert raw_value not in response.text

    def test_preview_endpoint_no_pii_fields(self):
        response = client.post(
            "/v1/ai/redaction/preview/structured",
            json={"fields": {"notes": "just context", "metric": "42"}},
        )
        assert response.status_code == 200
        result = response.json()["result"]
        assert result["redacted_fields"] == 0
        assert all(not status["redacted"] for status in result["fields"].values())

    def test_preview_endpoint_missing_fields_returns_422(self):
        response = client.post(
            "/v1/ai/redaction/preview/structured", json={}
        )
        assert response.status_code == 422


class TestOCREndpointRedaction:
    _FAKE_OCR_RESULT = OCRResult(
        fields={
            "full_name": FieldMatch(value="Aisha Bello", confidence=0.95),
            "national_id": FieldMatch(value="12345678901", confidence=0.92),
            "date_of_birth": FieldMatch(value="1990-01-15", confidence=0.90),
            "notes": FieldMatch(value="clear copy", confidence=0.70),
        },
        raw_text="Aisha Bello 12345678901 1990-01-15",
        processing_time_ms=10,
    )

    @staticmethod
    def _png_bytes():
        from PIL import Image

        img = Image.new("RGB", (60, 60), color="green")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def test_ocr_redacted_fields_by_default_unchanged(self):
        with patch(
            "services.ocr_job.ocr_service.process_image",
            return_value=self._FAKE_OCR_RESULT,
        ):
            response = client.post(
                "/v1/ai/ocr",
                files={"image": ("id.png", self._png_bytes(), "image/png")},
            )
        assert response.status_code == 200
        fields = response.json()["result"]["fields"]
        assert fields["full_name"]["value"] == "Aisha Bello"
        assert response.json()["reasons"] is None

    def test_ocr_responses_support_field_redaction_on_request(self):
        with patch(
            "services.ocr_job.ocr_service.process_image",
            return_value=self._FAKE_OCR_RESULT,
        ):
            response = client.post(
                "/v1/ai/ocr",
                files={"image": ("id.png", self._png_bytes(), "image/png")},
                data={"redact_fields": "true"},
            )
        assert response.status_code == 200
        body = response.json()
        fields = body["result"]["fields"]

        assert fields["full_name"]["value"] == "[RECIPIENT_NAME]"
        assert fields["national_id"]["value"] == "[ID_NUMBER]"
        assert fields["date_of_birth"]["value"] == "[EVENT_DATE]"
        # Unrecognized field types are never lost.
        assert fields["notes"]["value"] == "clear copy"
        assert "Aisha Bello" not in response.text
        assert body["reasons"] == [
            "Extracted fields were redacted by their known field type."
        ]