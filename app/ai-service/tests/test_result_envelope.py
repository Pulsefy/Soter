"""
Tests for the standardized result envelope across AI endpoints (Issue #609).

Every successful AI inference response must conform to:
  {
    "result":          <endpoint-specific payload>,
    "confidence":      float | null,
    "reasons":         list[str] | null,
    "anchor_metadata": object | null,
    "trace_id":        str | null,
  }
"""
from __future__ import annotations

import json
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from main import app

client = TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def assert_envelope(data: Dict[str, Any]) -> None:
    """Assert that *data* is a well-formed ResultEnvelope."""
    assert "result" in data, f"Missing 'result' key: {data}"
    assert "confidence" in data, f"Missing 'confidence' key: {data}"
    assert "reasons" in data, f"Missing 'reasons' key: {data}"
    assert "anchor_metadata" in data, f"Missing 'anchor_metadata' key: {data}"
    assert "trace_id" in data, f"Missing 'trace_id' key: {data}"

    # confidence is either null or a float in [0, 1]
    if data["confidence"] is not None:
        assert isinstance(data["confidence"], float), (
            f"confidence must be float, got {type(data['confidence'])}"
        )
        assert 0.0 <= data["confidence"] <= 1.0, (
            f"confidence out of range: {data['confidence']}"
        )

    # reasons is either null or a non-empty list of strings
    if data["reasons"] is not None:
        assert isinstance(data["reasons"], list), (
            f"reasons must be list, got {type(data['reasons'])}"
        )
        assert len(data["reasons"]) > 0, "reasons list must not be empty"
        for r in data["reasons"]:
            assert isinstance(r, str), f"Each reason must be a string, got {type(r)}"


# ---------------------------------------------------------------------------
# OCR endpoint
# ---------------------------------------------------------------------------

class TestOCREnvelope:
    _FAKE_OCR_RESULT = {
        "success": True,
        "data": {
            "fields": {
                "full_name": {"value": "Jane Doe", "confidence": 0.95},
                "id_number": {"value": "987654321", "confidence": 0.88},
            },
            "raw_text": "Jane Doe\nID: 987654321",
            "processing_time_ms": 120,
        },
        "processing_time_ms": 120,
        "anchor_metadata": None,
    }

    def _post_ocr(self, anchor_metadata: str | None = None) -> Dict[str, Any]:
        from io import BytesIO
        from PIL import Image

        buf = BytesIO()
        Image.new("RGB", (10, 10), color=(255, 0, 0)).save(buf, format="PNG")
        buf.seek(0)

        data: Dict[str, Any] = {"image": ("test.png", buf, "image/png")}
        if anchor_metadata:
            data["anchor_metadata"] = (None, anchor_metadata)

        with patch("api.v1.ocr.run_ocr_from_bytes", return_value=self._FAKE_OCR_RESULT):
            return client.post("/v1/ai/ocr", files=data).json()

    def test_envelope_shape(self):
        data = self._post_ocr()
        assert_envelope(data)

    def test_result_contains_fields(self):
        data = self._post_ocr()
        assert "fields" in data["result"]
        assert "raw_text" in data["result"]

    def test_confidence_derived_from_field_scores(self):
        data = self._post_ocr()
        # avg(0.95, 0.88) = 0.915
        assert data["confidence"] is not None
        assert 0.0 <= data["confidence"] <= 1.0

    def test_anchor_metadata_passthrough(self):
        anchor = json.dumps({"campaign_ref": "camp-001", "claim_id": "c-123"})
        fake_with_anchor = {
            "success": True,
            "data": {
                "fields": {
                    "full_name": {"value": "Jane Doe", "confidence": 0.95},
                    "id_number": {"value": "987654321", "confidence": 0.88},
                },
                "raw_text": "Jane Doe\nID: 987654321",
                "processing_time_ms": 120,
            },
            "processing_time_ms": 120,
            # anchor_metadata returned as a parsed dict by run_ocr_from_bytes
            "anchor_metadata": {"campaign_ref": "camp-001", "claim_id": "c-123"},
        }
        from io import BytesIO
        from PIL import Image

        buf = BytesIO()
        Image.new("RGB", (10, 10), color=(255, 0, 0)).save(buf, format="PNG")
        buf.seek(0)
        data: Dict[str, Any] = {
            "image": ("test.png", buf, "image/png"),
            "anchor_metadata": (None, anchor),
        }
        with patch("api.v1.ocr.run_ocr_from_bytes", return_value=fake_with_anchor):
            resp = client.post("/v1/ai/ocr", files=data)
        data = resp.json()
        assert data["anchor_metadata"] is not None
        assert data["anchor_metadata"]["campaign_ref"] == "camp-001"


# ---------------------------------------------------------------------------
# Fraud detection endpoint
# ---------------------------------------------------------------------------

class TestFraudEnvelope:
    _CLAIMS_PAYLOAD = {
        "claims": [
            {"claim_id": "c1", "ip_address": "1.2.3.4", "amount": 100.0, "location": "Lagos"},
            {"claim_id": "c2", "ip_address": "1.2.3.4", "amount": 100.0, "location": "Lagos"},
        ],
        "anchor_metadata": {"campaign_ref": "camp-002"},
    }

    def test_envelope_shape(self):
        resp = client.post("/v1/fraud/detect", json=self._CLAIMS_PAYLOAD)
        assert resp.status_code == 200
        assert_envelope(resp.json())

    def test_result_is_list(self):
        data = client.post("/v1/fraud/detect", json=self._CLAIMS_PAYLOAD).json()
        assert isinstance(data["result"], list)
        for item in data["result"]:
            assert "claim_id" in item
            assert "fraud_risk_score" in item
            assert "is_flagged" in item

    def test_confidence_in_range(self):
        data = client.post("/v1/fraud/detect", json=self._CLAIMS_PAYLOAD).json()
        assert data["confidence"] is not None
        assert 0.0 <= data["confidence"] <= 1.0

    def test_anchor_metadata_passthrough(self):
        data = client.post("/v1/fraud/detect", json=self._CLAIMS_PAYLOAD).json()
        assert data["anchor_metadata"]["campaign_ref"] == "camp-002"


# ---------------------------------------------------------------------------
# Anonymize endpoint
# ---------------------------------------------------------------------------

class TestAnonymizeEnvelope:
    _FAKE_ANONYMIZE = {
        "original_length": 49,
        "anonymized_text": "[NAME] from [LOCATION] on [DATE] requested aid",
        "pii_summary": {"names": 1, "locations": 1, "dates": 1, "total": 3},
        "token_counts": {"[RECIPIENT_NAME]": 1},
    }

    def test_envelope_shape(self):
        with patch.object(
            main.pii_scrubber_service, "anonymize", return_value=self._FAKE_ANONYMIZE
        ):
            resp = client.post(
                "/v1/ai/anonymize",
                json={"text": "John Doe from New York on 2024-01-01 requested aid"},
            )
        assert resp.status_code == 200
        assert_envelope(resp.json())

    def test_result_contains_anonymized_text(self):
        with patch.object(
            main.pii_scrubber_service, "anonymize", return_value=self._FAKE_ANONYMIZE
        ):
            data = client.post(
                "/v1/ai/anonymize",
                json={"text": "John Doe from New York on 2024-01-01 requested aid"},
            ).json()
        assert "anonymized_text" in data["result"]

    def test_confidence_is_null(self):
        """PII scrubbing is deterministic — confidence should be null."""
        with patch.object(
            main.pii_scrubber_service, "anonymize", return_value=self._FAKE_ANONYMIZE
        ):
            data = client.post(
                "/v1/ai/anonymize",
                json={"text": "John Doe from New York on 2024-01-01 requested aid"},
            ).json()
        assert data["confidence"] is None

    def test_reasons_reports_pii_count(self):
        with patch.object(
            main.pii_scrubber_service, "anonymize", return_value=self._FAKE_ANONYMIZE
        ):
            data = client.post(
                "/v1/ai/anonymize",
                json={"text": "John Doe from New York on 2024-01-01 requested aid"},
            ).json()
        assert data["reasons"] is not None
        assert len(data["reasons"]) > 0


# ---------------------------------------------------------------------------
# Proof-of-life endpoint
# ---------------------------------------------------------------------------

class TestProofOfLifeEnvelope:
    _FAKE_POL_RESULT = {
        "is_real_person": True,
        "confidence": 0.93,
        "threshold": 0.8,
        "checks": {"face_detected": True, "liveness_check": "passed"},
        "reason": "Liveness verification passed",
    }

    def test_envelope_shape(self):
        with patch.object(
            main.proof_of_life_analyzer, "analyze", return_value=self._FAKE_POL_RESULT
        ):
            resp = client.post(
                "/v1/ai/proof-of-life",
                json={"selfie_image_base64": "aW1hZ2U="},
            )
        assert resp.status_code == 200
        assert_envelope(resp.json())

    def test_confidence_promoted_to_envelope(self):
        with patch.object(
            main.proof_of_life_analyzer, "analyze", return_value=self._FAKE_POL_RESULT
        ):
            data = client.post(
                "/v1/ai/proof-of-life",
                json={"selfie_image_base64": "aW1hZ2U="},
            ).json()
        assert data["confidence"] == pytest.approx(0.93)

    def test_reason_promoted_to_reasons_list(self):
        with patch.object(
            main.proof_of_life_analyzer, "analyze", return_value=self._FAKE_POL_RESULT
        ):
            data = client.post(
                "/v1/ai/proof-of-life",
                json={"selfie_image_base64": "aW1hZ2U="},
            ).json()
        assert data["reasons"] == ["Liveness verification passed"]

    def test_result_contains_is_real_person(self):
        with patch.object(
            main.proof_of_life_analyzer, "analyze", return_value=self._FAKE_POL_RESULT
        ):
            data = client.post(
                "/v1/ai/proof-of-life",
                json={"selfie_image_base64": "aW1hZ2U="},
            ).json()
        assert data["result"]["is_real_person"] is True


# ---------------------------------------------------------------------------
# Humanitarian endpoint
# ---------------------------------------------------------------------------

class TestHumanitarianEnvelope:
    _FAKE_VERIFY = {
        "provider": "test",
        "model": "test-provider/fixture",
        "prompt_variant": "primary",
        "verification": {
            "verdict": "credible",
            "confidence": 0.82,
            "reasoning": "Claim meets humanitarian criteria",
        },
        "raw_response": '{"verdict":"credible","confidence":0.82}',
    }

    _REQUEST = {
        "aid_claim": "Family of 5 displaced by flooding needs food and shelter",
        "supporting_evidence": ["photo of damaged home"],
        "context_factors": {"location": "Kano, Nigeria"},
        "anchor_metadata": {"campaign_ref": "camp-hum-001"},
    }

    def test_envelope_shape(self):
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=self._FAKE_VERIFY,
        ):
            resp = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST)
        assert resp.status_code == 200
        assert_envelope(resp.json())

    def test_confidence_extracted_from_verification(self):
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=self._FAKE_VERIFY,
        ):
            data = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST).json()
        assert data["confidence"] == pytest.approx(0.82)

    def test_reasons_extracted_from_verification(self):
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=self._FAKE_VERIFY,
        ):
            data = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST).json()
        assert data["reasons"] == ["Claim meets humanitarian criteria"]

    def test_anchor_metadata_passthrough(self):
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=self._FAKE_VERIFY,
        ):
            data = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST).json()
        assert data["anchor_metadata"]["campaign_ref"] == "camp-hum-001"

    def test_result_contains_provider(self):
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=self._FAKE_VERIFY,
        ):
            data = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST).json()
        assert data["result"]["provider"] == "test"
