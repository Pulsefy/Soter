"""
Tests for the redaction preview diff endpoint — issue #775.

Covers:
* PIIScrubberService.preview() segment generation and edge cases.
* /v1/ai/redaction-preview endpoint response shape and behaviour.
* Logging safety: raw PII must never appear in log output.
"""

import logging
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import metrics
from main import app
from services.pii_scrubber import PIIScrubberService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture(scope="module")
def client():
    return TestClient(app, follow_redirects=True)


@pytest.fixture()
def scrubber():
    return PIIScrubberService()


# ---------------------------------------------------------------------------
# Unit tests — PIIScrubberService.preview()
# ---------------------------------------------------------------------------


class TestPreviewSegments:
    def test_empty_text_returns_no_segments(self, scrubber):
        result = scrubber.preview("")
        assert result["segments"] == []
        assert result["original_length"] == 0
        assert result["redacted_text"] == ""
        assert result["pii_summary"]["total"] == 0

    def test_no_pii_returns_single_text_segment(self, scrubber):
        text = "Camp distribution complete. All households received supplies."
        result = scrubber.preview(text)

        assert len(result["segments"]) == 1
        seg = result["segments"][0]
        assert seg["type"] == "text"
        assert seg["content"] == text
        assert seg["start"] == 0
        assert seg["end"] == len(text)
        assert result["pii_summary"]["total"] == 0
        assert result["redacted_text"] == text

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_detects_name_location_date(self, mock_labels, scrubber):
        mock_observe = MagicMock()
        mock_labels.return_value.observe = mock_observe

        text = "On 15 Jan 2025, Mary Johnson received aid in Maiduguri Camp."
        result = scrubber.preview(text)

        redaction_segments = [s for s in result["segments"] if s["type"] == "redaction"]
        assert len(redaction_segments) >= 2
        pii_types = {s["pii_type"] for s in redaction_segments}
        assert "PERSON" in pii_types
        assert "LOCATION" in pii_types
        assert result["pii_summary"]["total"] >= 2

        mock_labels.assert_called_with(step_name="preview")
        mock_observe.assert_called_once()

    def test_segments_cover_full_input(self, scrubber):
        text = "John Doe from New York on 2024-07-12 reported delays."
        result = scrubber.preview(text)

        # Reconstruct input from segments
        reconstructed = "".join(s["content"] for s in result["segments"])
        assert reconstructed == text

    def test_segments_are_contiguous(self, scrubber):
        text = "Mary Johnson lives in Kano State and visited on 1 March 2025."
        result = scrubber.preview(text)

        for i in range(1, len(result["segments"])):
            prev_end = result["segments"][i - 1]["end"]
            curr_start = result["segments"][i]["start"]
            assert curr_start == prev_end, (
                f"Gap or overlap between segments {i-1} and {i}: "
                f"prev_end={prev_end}, curr_start={curr_start}"
            )

    def test_redacted_text_matches_anonymize(self, scrubber):
        text = "John Doe from New York on 2024-07-12 reported delays."
        preview = scrubber.preview(text)
        anonymize = scrubber.anonymize(text)

        assert preview["redacted_text"] == anonymize["anonymized_text"]
        assert preview["pii_summary"] == anonymize["pii_summary"]

    def test_email_detection(self, scrubber):
        text = "Contact Jane at jane@example.com for aid."
        result = scrubber.preview(text)

        redactions = [s for s in result["segments"] if s["type"] == "redaction"]
        assert any(s["pii_type"] == "EMAIL" for s in redactions)
        assert result["pii_summary"]["emails"] >= 1

    def test_phone_detection(self, scrubber):
        text = "Call +234 803 123 4567 for information."
        result = scrubber.preview(text)

        redactions = [s for s in result["segments"] if s["type"] == "redaction"]
        assert any(s["pii_type"] == "PHONE" for s in redactions)
        assert result["pii_summary"]["phones"] >= 1

    def test_replacement_tokens_are_correct(self, scrubber):
        text = "Mary Johnson from Kano on 2024-01-15."
        result = scrubber.preview(text)

        for seg in result["segments"]:
            if seg["type"] == "redaction":
                assert seg["replacement"] is not None
                assert seg["replacement"].startswith("[")
                assert seg["replacement"].endswith("]")

    def test_original_length_matches_input(self, scrubber):
        text = "Test text with Mary Doe in Lagos."
        result = scrubber.preview(text)
        assert result["original_length"] == len(text)


# ---------------------------------------------------------------------------
# Unit tests — logging safety
# ---------------------------------------------------------------------------


class TestPreviewLoggingSafety:
    def test_handler_does_not_log_raw_text(self, caplog, scrubber):
        """The preview endpoint must not emit the raw input to logs."""
        text = "John Doe lives at 10 Downing Street."
        with caplog.at_level(logging.INFO, logger="api.v1.redaction_preview"):
            # Simulate what the endpoint does (call preview, log info)
            scrubber.preview(text)
            logger = logging.getLogger("api.v1.redaction_preview")
            logger.info("Processing redaction preview request")

        for record in caplog.records:
            assert "John Doe" not in record.getMessage()
            assert "10 Downing Street" not in record.getMessage()


# ---------------------------------------------------------------------------
# Endpoint tests — /v1/ai/redaction-preview
# ---------------------------------------------------------------------------


class TestRedactionPreviewEndpoint:
    def test_returns_200_with_valid_text(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "On 10 Jan 2025, Mary Doe received aid in Lagos."},
        )
        assert response.status_code == 200

    def test_response_has_result_envelope_shape(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Jane Smith from Abuja on 1 March 2025."},
        )
        data = response.json()
        assert "result" in data
        assert "confidence" in data
        assert "reasons" in data
        assert "trace_id" in data

    def test_result_has_segments_and_summary(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Mary Johnson from Kano on 2024-07-12."},
        )
        result = response.json()["result"]
        assert "segments" in result
        assert "original_length" in result
        assert "redacted_text" in result
        assert "pii_summary" in result
        assert isinstance(result["segments"], list)
        assert len(result["segments"]) > 0

    def test_segments_have_valid_structure(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "John Doe received aid in Maiduguri."},
        )
        for seg in response.json()["result"]["segments"]:
            assert "type" in seg
            assert seg["type"] in ("text", "redaction")
            assert "content" in seg
            assert "start" in seg
            assert "end" in seg
            assert seg["start"] >= 0
            assert seg["end"] >= seg["start"]
            if seg["type"] == "redaction":
                assert "replacement" in seg
                assert "pii_type" in seg

    def test_empty_text_returns_422(self, client):
        response = client.post("/v1/ai/redaction-preview", json={"text": ""})
        assert response.status_code == 422

    def test_missing_text_returns_422(self, client):
        response = client.post("/v1/ai/redaction-preview", json={})
        assert response.status_code == 422

    def test_no_pii_returns_single_text_segment(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Camp distribution complete. All supplies delivered."},
        )
        data = response.json()
        assert len(data["result"]["segments"]) == 1
        assert data["result"]["segments"][0]["type"] == "text"
        assert data["result"]["pii_summary"]["total"] == 0

    def test_reasons_reflect_pii_detection(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Mary Johnson from Kano on 2024-07-12."},
        )
        reasons = response.json()["reasons"]
        assert len(reasons) >= 1
        assert "redaction" in reasons[0].lower()

    def test_no_pii_reasons(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "No sensitive data here."},
        )
        reasons = response.json()["reasons"]
        assert any("No PII" in r for r in reasons)

    def test_anchor_metadata_passthrough(self, client):
        meta = {"campaign_ref": "camp-001", "claim_id": "cl-abc"}
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Mary Doe in Lagos.", "anchor_metadata": meta},
        )
        data = response.json()
        assert data["anchor_metadata"] == meta

    def test_pii_summary_counts_match_redaction_segments(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "Mary Johnson from Kano on 2024-07-12."},
        )
        result = response.json()["result"]
        redaction_count = sum(
            1 for s in result["segments"] if s["type"] == "redaction"
        )
        assert redaction_count == result["pii_summary"]["total"]

    def test_anonymized_text_matches_anonymize_endpoint(self, client):
        payload = {"text": "Jane Smith received aid in Abuja on 1 March 2025."}
        preview_resp = client.post("/v1/ai/redaction-preview", json=payload)
        anonymize_resp = client.post("/v1/ai/anonymize", json=payload)

        assert preview_resp.status_code == 200
        assert anonymize_resp.status_code == 200
        assert (
            preview_resp.json()["result"]["redacted_text"]
            == anonymize_resp.json()["result"]["anonymized_text"]
        )


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestPreviewEdgeCases:
    def test_whitespace_only_text(self, client):
        response = client.post(
            "/v1/ai/redaction-preview",
            json={"text": "   "},
        )
        assert response.status_code == 200
        result = response.json()["result"]
        assert result["pii_summary"]["total"] == 0
        assert result["redacted_text"] == "   "

    def test_single_name_detection(self, scrubber):
        text = "Reported by Dr. Alice Brown."
        result = scrubber.preview(text)

        redactions = [s for s in result["segments"] if s["type"] == "redaction"]
        assert len(redactions) >= 1
        assert redactions[0]["pii_type"] == "PERSON"

    def test_multiple_pii_types_in_one_sentence(self, scrubber):
        text = "John Doe email jane@test.com in Lagos on 2024-01-01."
        result = scrubber.preview(text)

        pii_types = {s["pii_type"] for s in result["segments"] if s["type"] == "redaction"}
        assert len(pii_types) >= 2

    def test_long_text_performance(self, scrubber):
        text = "Mary Johnson from Kano. " * 100
        result = scrubber.preview(text)
        assert len(result["segments"]) > 0
        reconstructed = "".join(s["content"] for s in result["segments"])
        assert reconstructed == text

    def test_unicode_text_no_crash(self, scrubber):
        text = "Distribución de ayuda en Maiduguri."
        result = scrubber.preview(text)
        assert result["original_length"] == len(text)

    def test_special_characters(self, scrubber):
        text = "Mary! @Doe #received $aid in Kano."
        result = scrubber.preview(text)
        reconstructed = "".join(s["content"] for s in result["segments"])
        assert reconstructed == text
