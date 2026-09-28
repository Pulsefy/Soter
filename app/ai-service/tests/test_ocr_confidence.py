"""Tests for OCR confidence banding and manual-review routing (issue #984).

Covers the three cases the issue calls out explicitly: an extraction whose
confidence is above the review threshold, one that falls below it, and one
that carries no confidence at all.  Also checks that the banding survives the
full ``run_ocr_from_bytes`` path and reaches the backend callback payload.
"""

import io
import json
from dataclasses import dataclass

import pytest
from PIL import Image

from config import ConfigurationError, Settings
from schemas.callback import AiCallbackPayload, CallbackStatus
from schemas.ocr import OCRConfidenceBand
from services.ocr import FieldMatch, OCRResult
from services.ocr_confidence import (
    REASON_BELOW_THRESHOLD,
    REASON_MISSING_CONFIDENCE,
    aggregate_confidence,
    assess_confidence,
    resolve_review_threshold,
)
import services.ocr_job as ocr_job


def _settings(**overrides) -> Settings:
    settings = Settings(_env_file=None)
    for key, value in overrides.items():
        setattr(settings, key, value)
    return settings


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color="white").save(buf, format="PNG")
    return buf.getvalue()


@dataclass
class _StubOCRService:
    """Minimal OCR service that returns pre-built fields."""

    fields: dict

    def process_image(self, image, language_hint=None) -> OCRResult:
        return OCRResult(fields=self.fields, raw_text="raw text", processing_time_ms=5)


# ---------------------------------------------------------------------------
# aggregate_confidence
# ---------------------------------------------------------------------------


def test_aggregate_confidence_averages_available_values():
    assert aggregate_confidence([0.9, 0.8, 0.7]) == pytest.approx(0.8)


def test_aggregate_confidence_ignores_missing_values():
    # A field without a confidence must not be counted as zero.
    assert aggregate_confidence([0.9, None, 1.0]) == pytest.approx(0.95)


def test_aggregate_confidence_is_none_when_nothing_is_available():
    assert aggregate_confidence([]) is None
    assert aggregate_confidence([None, None]) is None


# ---------------------------------------------------------------------------
# assess_confidence: the three cases from the issue
# ---------------------------------------------------------------------------


def test_above_threshold_is_banded_high_and_not_flagged():
    assessment = assess_confidence([0.95, 0.92], settings=_settings())

    assert assessment.confidence == pytest.approx(0.935)
    assert assessment.band == OCRConfidenceBand.high
    assert assessment.needs_review is False
    assert assessment.reasons == []


def test_between_thresholds_is_banded_medium_and_not_flagged():
    assessment = assess_confidence([0.80, 0.82], settings=_settings())

    assert assessment.confidence == pytest.approx(0.81)
    assert assessment.band == OCRConfidenceBand.medium
    assert assessment.needs_review is False


def test_below_threshold_is_flagged_for_review():
    assessment = assess_confidence([0.60, 0.62], settings=_settings())

    assert assessment.confidence == pytest.approx(0.61)
    assert assessment.band == OCRConfidenceBand.low
    assert assessment.needs_review is True
    assert assessment.reasons == [REASON_BELOW_THRESHOLD]


def test_missing_confidence_is_flagged_for_review():
    assessment = assess_confidence([None, None], settings=_settings())

    assert assessment.confidence is None
    assert assessment.band == OCRConfidenceBand.low
    assert assessment.needs_review is True
    assert assessment.reasons == [REASON_MISSING_CONFIDENCE]


def test_empty_result_is_flagged_for_review():
    assessment = assess_confidence([], settings=_settings())

    assert assessment.confidence is None
    assert assessment.needs_review is True


# ---------------------------------------------------------------------------
# Per-document-type thresholds
# ---------------------------------------------------------------------------


def test_document_type_override_raises_the_review_bar():
    settings = _settings()

    # 0.80 clears the global threshold (0.75) but not the passport override
    # (0.85), so the same score is banded differently per document type.
    global_assessment = assess_confidence([0.80], settings=settings)
    passport_assessment = assess_confidence(
        [0.80], document_type="passport", settings=settings
    )

    assert global_assessment.needs_review is False
    assert passport_assessment.needs_review is True
    assert passport_assessment.review_threshold == pytest.approx(0.85)


def test_unknown_document_type_falls_back_to_global_threshold():
    settings = _settings()

    assert resolve_review_threshold("not-configured", settings) == pytest.approx(
        settings.ocr_confidence_review_threshold
    )
    assert resolve_review_threshold(None, settings) == pytest.approx(
        settings.ocr_confidence_review_threshold
    )
    # Lookup is case/whitespace-insensitive.
    assert resolve_review_threshold(" Passport ", settings) == pytest.approx(0.85)


# ---------------------------------------------------------------------------
# End-to-end through run_ocr_from_bytes and the callback payload
# ---------------------------------------------------------------------------


def test_run_ocr_from_bytes_flags_low_confidence(monkeypatch):
    monkeypatch.setattr(
        ocr_job,
        "ocr_service",
        _StubOCRService({"name": FieldMatch(value="Jane", confidence=0.5)}),
    )

    result = ocr_job.run_ocr_from_bytes(_png_bytes())

    assert result["needs_review"] is True
    assert result["confidence"] == pytest.approx(0.5)
    assert result["confidence_band"] == "low"
    assert result["data"]["needs_review"] is True
    assert result["data"]["confidence_band"] == "low"


def test_run_ocr_from_bytes_clears_confident_extraction(monkeypatch):
    monkeypatch.setattr(
        ocr_job,
        "ocr_service",
        _StubOCRService({"name": FieldMatch(value="Jane", confidence=0.97)}),
    )

    result = ocr_job.run_ocr_from_bytes(_png_bytes())

    assert result["needs_review"] is False
    assert result["confidence_band"] == "high"
    assert result["data"]["needs_review"] is False


def test_run_ocr_from_bytes_flags_missing_confidence(monkeypatch):
    monkeypatch.setattr(ocr_job, "ocr_service", _StubOCRService({}))

    result = ocr_job.run_ocr_from_bytes(_png_bytes())

    assert result["confidence"] is None
    assert result["needs_review"] is True
    assert result["review_reasons"] == [REASON_MISSING_CONFIDENCE]


def test_review_flag_reaches_callback_payload(monkeypatch):
    monkeypatch.setattr(
        ocr_job,
        "ocr_service",
        _StubOCRService({"name": FieldMatch(value="Jane", confidence=0.4)}),
    )
    result = ocr_job.run_ocr_from_bytes(_png_bytes())

    payload = AiCallbackPayload.build(
        task_id="ocr-task-1",
        status=CallbackStatus.COMPLETED,
        result=result,
        task_type="ocr",
    )
    body = json.loads(payload.to_json_bytes())

    assert body["result"]["needs_review"] is True
    assert body["result"]["confidence_band"] == "low"


# ---------------------------------------------------------------------------
# Configuration validation
# ---------------------------------------------------------------------------


def test_review_threshold_above_high_threshold_is_rejected():
    settings = _settings(
        ocr_confidence_review_threshold=0.95, ocr_confidence_high_threshold=0.90
    )

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "OCR_CONFIDENCE_REVIEW_THRESHOLD" in str(excinfo.value)


def test_out_of_range_document_type_threshold_is_rejected():
    settings = _settings(ocr_confidence_thresholds_by_document_type={"id_card": 1.5})

    with pytest.raises(ConfigurationError) as excinfo:
        settings.validate_configuration()

    assert "OCR_CONFIDENCE_THRESHOLDS_BY_DOCUMENT_TYPE" in str(excinfo.value)
