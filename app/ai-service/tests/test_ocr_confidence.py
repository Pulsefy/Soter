import pytest

from services.ocr_job import assess_confidence


@pytest.fixture(autouse=True)
def clear_ocr_env(monkeypatch):
    monkeypatch.delenv("OCR_REVIEW_CONFIDENCE_THRESHOLD", raising=False)
    monkeypatch.delenv("OCR_HIGH_CONFIDENCE_THRESHOLD", raising=False)
    monkeypatch.delenv("OCR_REVIEW_CONFIDENCE_THRESHOLD_PASSPORT", raising=False)


def test_above_threshold_does_not_require_review():
    band, review = assess_confidence(0.95)
    assert band == "high"
    assert review is False


def test_below_threshold_requires_review():
    band, review = assess_confidence(0.5)
    assert band == "low"
    assert review is True


def test_missing_confidence_requires_review():
    band, review = assess_confidence(None)
    assert band == "unknown"
    assert review is True


def test_document_type_specific_threshold(monkeypatch):
    monkeypatch.setenv("OCR_REVIEW_CONFIDENCE_THRESHOLD_PASSPORT", "0.8")
    band, review = assess_confidence(0.75, "passport")
    assert band == "low"
    assert review is True


def test_medium_band_between_thresholds():
    band, review = assess_confidence(0.8)
    assert band == "medium"
    assert review is False
