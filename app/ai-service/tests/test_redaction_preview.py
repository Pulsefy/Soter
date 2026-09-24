from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from main import app
from services.pii_scrubber import PIIScrubberService

client = TestClient(app)


class TestBuildPreviewSegments:
    """Unit tests on the segment-builder — no HTTP layer involved."""

    def setup_method(self):
        self.service = PIIScrubberService()

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_segments_cover_full_text_with_kept_and_redacted(self, mock_labels):
        mock_labels.return_value.observe = MagicMock()

        text = "On 15 Jan 2025, Mary Johnson received aid in Maiduguri Camp."
        spans = self.service.detect_spans(text)
        segments = self.service.build_preview_segments(text, spans)

        assert segments[0]["start"] == 0
        assert segments[-1]["end"] == len(text)
        for a, b in zip(segments, segments[1:]):
            assert a["end"] == b["start"]

        redacted_categories = {
            s["category"] for s in segments if s["type"] == "redacted"
        }
        assert "RECIPIENT_NAME" in redacted_categories
        assert "LOCATION" in redacted_categories
        assert "EVENT_DATE" in redacted_categories

    def test_kept_segments_have_no_category(self):
        text = "John Doe reported delays in Kano State on 2024-07-12."
        spans = self.service.detect_spans(text)
        segments = self.service.build_preview_segments(text, spans)

        for seg in segments:
            if seg["type"] == "kept":
                assert seg["category"] is None

    def test_no_pii_returns_single_kept_segment(self):
        text = "The weather today is sunny with clear skies."
        spans = self.service.detect_spans(text)
        segments = self.service.build_preview_segments(text, spans)

        assert len(segments) == 1
        assert segments[0]["type"] == "kept"
        assert segments[0]["start"] == 0
        assert segments[0]["end"] == len(text)

    def test_empty_text_returns_no_segments(self):
        spans = self.service.detect_spans("")
        segments = self.service.build_preview_segments("", spans)
        assert segments == []

    def test_entirely_sensitive_text_single_redacted_segment(self):
        text = "Mary Johnson"
        spans = self.service.detect_spans(text)
        segments = self.service.build_preview_segments(text, spans)

        assert len(segments) == 1
        assert segments[0]["type"] == "redacted"
        assert segments[0]["start"] == 0
        assert segments[0]["end"] == len(text)


class TestRedactionPreviewRoute:
    """Integration tests against the FastAPI app."""

    def test_preview_endpoint_returns_segments(self):
        response = client.post(
            "/v1/ai/redaction/preview",
            json={"text": "Mary Johnson received aid in Maiduguri Camp."},
        )
        assert response.status_code == 200
        result = response.json()["result"]

        assert result["original_length"] == len(
            "Mary Johnson received aid in Maiduguri Camp."
        )
        assert len(result["segments"]) > 0
        assert any(seg["type"] == "redacted" for seg in result["segments"])
        assert "Mary Johnson" not in str(result["segments"])

    def test_preview_endpoint_no_pii(self):
        response = client.post(
            "/v1/ai/redaction/preview",
            json={"text": "The sky is clear today."},
        )
        assert response.status_code == 200
        result = response.json()["result"]
        assert result["pii_summary"]["total"] == 0
        assert all(seg["type"] == "kept" for seg in result["segments"])

    def test_preview_endpoint_does_not_log_raw_text(self, caplog):
        sensitive_text = "Mary Johnson's ID is AB12345678"
        client.post("/v1/ai/redaction/preview", json={"text": sensitive_text})

        for record in caplog.records:
            assert sensitive_text not in record.getMessage()
            assert "Mary Johnson" not in record.getMessage()
