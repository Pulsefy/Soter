"""Unit tests for confidence calibration reporting."""

import os

from regression_harness.calibration import (
    DEFAULT_BANDS,
    compute_calibration,
    render_calibration_markdown,
    write_calibration_report,
)


def _outcome(case_id, confidence, correct):
    return {
        "id": case_id,
        "confidence": confidence,
        "correct": correct,
        "expected": "approve",
        "predicted": "approve" if correct else "reject",
    }


def _band(calibration, label):
    for band in calibration["bands"]:
        if band["band"] == label:
            return band
    raise AssertionError(f"unknown band {label}")


class TestBandBucketing:
    """Confidence values must land in the correct band, including edges."""

    def test_bounds_are_half_open(self):
        outcomes = [
            _outcome("c0", 0.0, True),
            _outcome("c049", 0.49, True),
            _outcome("c050", 0.50, True),
            _outcome("c069", 0.69, True),
            _outcome("c070", 0.70, True),
            _outcome("c089", 0.89, True),
            _outcome("c090", 0.90, True),
            _outcome("c100", 1.0, True),
        ]
        calibration = compute_calibration(outcomes)
        assert _band(calibration, "low (0.00-0.50)")["count"] == 2
        assert _band(calibration, "medium (0.50-0.70)")["count"] == 2
        assert _band(calibration, "high (0.70-0.90)")["count"] == 2
        assert _band(calibration, "very high (0.90-1.00)")["count"] == 2

    def test_out_of_range_confidence_is_unscored(self):
        outcomes = [
            _outcome("bad", 1.5, True),
            _outcome("none", None, False),
            _outcome("ok", 0.6, True),
        ]
        calibration = compute_calibration(outcomes)
        assert calibration["scored_cases"] == 1
        assert calibration["unscored"]["count"] == 2
        assert set(calibration["unscored"]["ids"]) == {"bad", "none"}


class TestAccuracyAndGap:
    """Accuracy, mean stated confidence, and gaps must be measured per band."""

    def test_gap_is_confidence_minus_accuracy(self):
        outcomes = [
            _outcome("a", 0.6, True),
            _outcome("b", 0.6, False),
        ]
        calibration = compute_calibration(outcomes)
        band = _band(calibration, "medium (0.50-0.70)")
        assert band["count"] == 2
        assert band["accuracy"] == 0.5
        assert band["mean_confidence"] == 0.6
        assert band["gap"] == 0.1
        assert band["status"] == "ok"

    def test_expected_calibration_error_is_case_weighted(self):
        outcomes = [
            _outcome("a", 0.9, True),
            _outcome("b", 0.9, True),
            _outcome("c", 0.3, False),
        ]
        calibration = compute_calibration(outcomes)
        # very high: |1.0 - 0.9| * 2 = 0.2 ; low: |0.0 - 0.3| * 1 = 0.3
        assert calibration["expected_calibration_error"] == round(0.5 / 3, 4)
        assert calibration["max_calibration_error"] == 0.3


class TestMiscalibrationFlags:
    """Bands far from their stated confidence must be flagged, not just noted."""

    def test_overconfident_band_is_flagged(self):
        outcomes = [
            _outcome("a", 0.9, False),
            _outcome("b", 0.9, False),
        ]
        calibration = compute_calibration(outcomes)
        assert calibration["is_calibrated"] is False
        assert len(calibration["flagged_bands"]) == 1
        flag = calibration["flagged_bands"][0]
        assert flag["direction"] == "overconfident"
        assert flag["gap"] == 0.9

    def test_underconfident_band_is_flagged(self):
        outcomes = [
            _outcome("a", 0.1, True),
            _outcome("b", 0.1, True),
        ]
        calibration = compute_calibration(outcomes)
        assert calibration["is_calibrated"] is False
        assert calibration["flagged_bands"][0]["direction"] == "underconfident"

    def test_within_tolerance_is_not_flagged(self):
        outcomes = [
            _outcome("a", 0.8, True),
            _outcome("b", 0.8, True),
            _outcome("c", 0.8, True),
            _outcome("d", 0.8, True),
            _outcome("e", 0.8, False),
        ]
        # accuracy 0.8, mean confidence 0.8 -> perfectly calibrated
        calibration = compute_calibration(outcomes)
        assert calibration["is_calibrated"] is True
        assert calibration["flagged_bands"] == []

    def test_empty_bands_report_as_empty(self):
        calibration = compute_calibration([_outcome("a", 0.9, True)])
        assert _band(calibration, "low (0.00-0.50)")["status"] == "empty"
        assert _band(calibration, "low (0.00-0.50)")["count"] == 0


class TestMarkdownRendering:
    """The committed reference report must carry bands and flags."""

    def test_markdown_includes_bands_and_flags(self):
        outcomes = [_outcome("a", 0.9, False), _outcome("b", 0.6, True)]
        calibration = compute_calibration(outcomes)
        markdown = render_calibration_markdown(
            calibration,
            generated_at="2026-01-01T00:00:00Z",
            fixture_count=2,
            overall_accuracy=0.5,
        )
        assert "# Confidence Calibration Report" in markdown
        for label, _, _ in DEFAULT_BANDS:
            assert label in markdown
        assert "very high (0.90-1.00)" in markdown
        assert "Miscalibration flags" in markdown
        assert "overconfident" in markdown

    def test_write_report_creates_file(self, tmp_path):
        calibration = compute_calibration([_outcome("a", 0.9, True)])
        target = os.path.join(tmp_path, "nested", "confidence_calibration.md")
        written = write_calibration_report(
            calibration,
            target,
            generated_at="2026-01-01T00:00:00Z",
        )
        assert written == target
        with open(target) as handle:
            content = handle.read()
        assert "Confidence Calibration Report" in content
