"""
Tests for the standardised result envelope across AI endpoints – Issue #609.

Every AI endpoint response must include:
  result          – str label for the AI decision
  confidence      – float in [0, 1] OR None (for deterministic/rule-based endpoints)
  reasons         – list of explanation strings OR None
  anchor_metadata – dict of correlating context OR None
  trace_id        – UUID-style string

Acceptance criteria:
  1. No breaking changes – all previously tested fields still present.
  2. Envelope fields present in every successful response.
  3. trace_id is a non-empty string that looks like a UUID.
  4. Schema validation: ResultEnvelope model enforces confidence bounds.
"""

import io
import re
import uuid
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

import main
import metrics
from main import app
from schemas.envelope import ResultEnvelope

client = TestClient(app, follow_redirects=True)

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Fixture: always report healthy resources so throttle never fires
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def assert_envelope(data: dict, *, has_confidence: bool = True) -> None:
    """Assert all standard envelope keys are present and well-formed."""
    assert "result" in data, f"Missing 'result' in response: {list(data.keys())}"
    assert "reasons" in data, f"Missing 'reasons' in response: {list(data.keys())}"
    assert "anchor_metadata" in data, f"Missing 'anchor_metadata' in response: {list(data.keys())}"
    assert "trace_id" in data, f"Missing 'trace_id' in response: {list(data.keys())}"
    assert "confidence" in data, f"Missing 'confidence' in response: {list(data.keys())}"

    assert data["trace_id"] is not None, "trace_id must not be None"
    assert UUID_RE.match(str(data["trace_id"])), (
        f"trace_id does not look like a UUID: {data['trace_id']}"
    )

    if has_confidence and data["confidence"] is not None:
        assert 0.0 <= data["confidence"] <= 1.0, (
            f"confidence out of [0, 1] range: {data['confidence']}"
        )

    if data["reasons"] is not None:
        assert isinstance(data["reasons"], list), "'reasons' must be a list or None"

    if data["anchor_metadata"] is not None:
        assert isinstance(data["anchor_metadata"], dict), (
            "'anchor_metadata' must be a dict or None"
        )


# ---------------------------------------------------------------------------
# 1. OCR endpoint
# ---------------------------------------------------------------------------

class TestOCREnvelope:
    def _post_image(self, color="white", size=(100, 100)):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", size, color=color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def test_ocr_envelope_fields_present(self):
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("test.png", self._post_image(), "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert_envelope(data)

    def test_ocr_result_label(self):
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("test.png", self._post_image(), "image/png")},
        )
        data = response.json()
        assert data["result"] in ("ocr_complete", "ocr_error")

    def test_ocr_trace_id_unique_per_request(self):
        img = self._post_image()
        r1 = client.post("/v1/ai/ocr", files={"image": ("t.png", img, "image/png")})
        r2 = client.post("/v1/ai/ocr", files={"image": ("t.png", img, "image/png")})
        assert r1.json()["trace_id"] != r2.json()["trace_id"]

    def test_ocr_backward_compat_fields_still_present(self):
        """Existing fields must not disappear."""
        response = client.post(
            "/v1/ai/ocr",
            files={"image": ("test.png", self._post_image(), "image/png")},
        )
        data = response.json()
        assert "success" in data
        assert "processing_time_ms" in data

    def test_legacy_ocr_envelope_fields_present(self):
        """Legacy /ai/ocr path must also carry the envelope."""
        response = client.post(
            "/ai/ocr",
            files={"image": ("test.png", self._post_image(), "image/png")},
        )
        assert response.status_code == 200
        assert_envelope(response.json())


# ---------------------------------------------------------------------------
# 2. Anonymize endpoint
# ---------------------------------------------------------------------------

class TestAnonymizeEnvelope:
    PAYLOAD = {"text": "On 1 Jan 2025, Jane Doe received aid in Lagos."}

    def test_anonymize_envelope_fields_present(self):
        response = client.post("/v1/ai/anonymize", json=self.PAYLOAD)
        assert response.status_code == 200
        assert_envelope(response.json(), has_confidence=False)

    def test_anonymize_result_label(self):
        data = client.post("/v1/ai/anonymize", json=self.PAYLOAD).json()
        assert data["result"] == "anonymization_complete"

    def test_anonymize_reasons_is_list(self):
        data = client.post("/v1/ai/anonymize", json=self.PAYLOAD).json()
        assert isinstance(data["reasons"], list)
        assert len(data["reasons"]) >= 1

    def test_anonymize_trace_id_unique(self):
        r1 = client.post("/v1/ai/anonymize", json=self.PAYLOAD).json()
        r2 = client.post("/v1/ai/anonymize", json=self.PAYLOAD).json()
        assert r1["trace_id"] != r2["trace_id"]

    def test_anonymize_backward_compat(self):
        data = client.post("/v1/ai/anonymize", json=self.PAYLOAD).json()
        for key in ("success", "anonymized_text", "original_length", "pii_summary"):
            assert key in data, f"Legacy field '{key}' missing"


# ---------------------------------------------------------------------------
# 3. Humanitarian endpoint
# ---------------------------------------------------------------------------

class TestHumanitarianEnvelope:
    PAYLOAD = {
        "aid_claim": "Teams distributed emergency kits to all registered households.",
        "supporting_evidence": ["Distribution list #B-17"],
        "context_factors": {},
        "provider_preference": "auto",
    }

    @pytest.fixture
    def fake_verify(self, monkeypatch):
        def _verify(aid_claim, supporting_evidence=None, context_factors=None,
                    provider_preference="auto", **_):
            return {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "prompt_variant": "primary",
                "verification": {
                    "verdict": "credible",
                    "confidence": 0.87,
                    "summary": "Claim is well-supported by the evidence.",
                },
                "raw_response": "{}",
            }
        monkeypatch.setattr(main.humanitarian_verification_service, "verify_claim", _verify)

    def test_humanitarian_envelope_fields_present(self, fake_verify):
        response = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD)
        assert response.status_code == 200
        assert_envelope(response.json())

    def test_humanitarian_result_label(self, fake_verify):
        data = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        assert data["result"].startswith("humanitarian_")

    def test_humanitarian_confidence_from_verification(self, fake_verify):
        data = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        assert data["confidence"] == pytest.approx(0.87)

    def test_humanitarian_reasons_contain_verdict(self, fake_verify):
        data = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        assert any("credible" in r.lower() for r in data["reasons"])

    def test_humanitarian_trace_id_unique(self, fake_verify):
        r1 = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        r2 = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        assert r1["trace_id"] != r2["trace_id"]

    def test_humanitarian_backward_compat(self, fake_verify):
        data = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        for key in ("success", "provider", "model", "verification"):
            assert key in data, f"Legacy field '{key}' missing"

    def test_humanitarian_error_path_has_envelope(self, monkeypatch):
        monkeypatch.setattr(
            main.humanitarian_verification_service,
            "verify_claim",
            lambda **_: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
        )
        data = client.post("/v1/ai/humanitarian/verify", json=self.PAYLOAD).json()
        assert data["success"] is False
        assert "trace_id" in data
        assert "result" in data


# ---------------------------------------------------------------------------
# 4. Fraud detection endpoint
# ---------------------------------------------------------------------------

class TestFraudEnvelope:
    PAYLOAD = {
        "claims": [
            {"claim_id": "C001", "amount": 100.0, "location": "Lagos"},
            {"claim_id": "C002", "amount": 9999.0, "location": "Lagos"},
        ]
    }

    def test_fraud_envelope_fields_present(self):
        response = client.post("/v1/fraud/detect", json=self.PAYLOAD)
        assert response.status_code == 200
        assert_envelope(response.json())

    def test_fraud_result_label_values(self):
        data = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        assert data["result"] in ("fraud_detected", "no_fraud_detected")

    def test_fraud_confidence_in_range(self):
        data = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        if data["confidence"] is not None:
            assert 0.0 <= data["confidence"] <= 1.0

    def test_fraud_reasons_mention_claim_count(self):
        data = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        assert any("2" in r or "claim" in r.lower() for r in data["reasons"])

    def test_fraud_trace_id_unique(self):
        r1 = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        r2 = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        assert r1["trace_id"] != r2["trace_id"]

    def test_fraud_backward_compat(self):
        data = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        for key in ("results", "flagged_count"):
            assert key in data, f"Legacy field '{key}' missing"

    def test_fraud_anchor_metadata_has_counts(self):
        data = client.post("/v1/fraud/detect", json=self.PAYLOAD).json()
        meta = data.get("anchor_metadata") or {}
        assert "total_claims" in meta
        assert "flagged_count" in meta


# ---------------------------------------------------------------------------
# 5. Proof-of-life endpoint
# ---------------------------------------------------------------------------

class TestProofOfLifeEnvelope:
    PAYLOAD = {"selfie_image_base64": "dGVzdA=="}

    @pytest.fixture
    def fake_analyze(self, monkeypatch):
        def _analyze(selfie_image_base64, burst_images_base64=None,
                     confidence_threshold=None):
            return {
                "is_real_person": True,
                "confidence": 0.93,
                "threshold": confidence_threshold or 0.65,
                "checks": {"face_detected": True, "blink_detected": False},
                "reason": "Face detected with high confidence",
            }
        monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", _analyze)

    def test_proof_of_life_envelope_fields_present(self, fake_analyze):
        response = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD)
        assert response.status_code == 200
        assert_envelope(response.json())

    def test_proof_of_life_result_real_person(self, fake_analyze):
        data = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        assert data["result"] == "real_person"

    def test_proof_of_life_confidence_value(self, fake_analyze):
        data = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        assert data["confidence"] == pytest.approx(0.93)

    def test_proof_of_life_reasons_from_reason(self, fake_analyze):
        data = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        assert isinstance(data["reasons"], list)
        assert any("face" in r.lower() for r in data["reasons"])

    def test_proof_of_life_trace_id_unique(self, fake_analyze):
        r1 = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        r2 = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        assert r1["trace_id"] != r2["trace_id"]

    def test_proof_of_life_backward_compat(self, fake_analyze):
        data = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        for key in ("is_real_person", "confidence", "threshold", "checks", "reason"):
            assert key in data, f"Legacy field '{key}' missing"

    def test_proof_of_life_not_real_person_result_label(self, monkeypatch):
        def _not_real(selfie_image_base64, burst_images_base64=None,
                      confidence_threshold=None):
            return {
                "is_real_person": False,
                "confidence": 0.22,
                "threshold": 0.65,
                "checks": {"face_detected": False},
                "reason": "No face detected",
            }
        monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", _not_real)
        data = client.post("/v1/ai/proof-of-life", json=self.PAYLOAD).json()
        assert data["result"] == "not_real_person"


# ---------------------------------------------------------------------------
# 6. Schema-level validation – ResultEnvelope
# ---------------------------------------------------------------------------

class TestResultEnvelopeSchema:
    def test_confidence_below_zero_rejected(self):
        with pytest.raises(Exception):
            ResultEnvelope(confidence=-0.1)

    def test_confidence_above_one_rejected(self):
        with pytest.raises(Exception):
            ResultEnvelope(confidence=1.1)

    def test_trace_id_auto_generated(self):
        envelope = ResultEnvelope()
        assert envelope.trace_id is not None
        assert UUID_RE.match(envelope.trace_id)

    def test_all_fields_optional(self):
        """ResultEnvelope must be constructable with no arguments."""
        envelope = ResultEnvelope()
        assert envelope.result is None
        assert envelope.confidence is None
        assert envelope.reasons is None
        assert envelope.anchor_metadata is None

    def test_explicit_trace_id_accepted(self):
        tid = str(uuid.uuid4())
        envelope = ResultEnvelope(trace_id=tid)
        assert envelope.trace_id == tid
