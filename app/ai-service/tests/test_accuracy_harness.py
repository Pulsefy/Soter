"""Unit tests for the golden-set accuracy harness and its offline provider."""

import json
import os

import pytest

from regression_harness.run_accuracy_harness import (
    LABELS,
    compare_with_baseline,
    compute_metrics,
    validate_fixtures,
)


class TestComputeMetrics:
    """Tests for the accuracy, precision, recall, and F1 calculations."""

    def test_all_correct(self):
        outcomes = [
            {"id": "1", "expected": "approve", "predicted": "approve", "correct": True},
            {"id": "2", "expected": "reject", "predicted": "reject", "correct": True},
            {
                "id": "3",
                "expected": "ambiguous",
                "predicted": "ambiguous",
                "correct": True,
            },
        ]
        metrics = compute_metrics(outcomes)
        assert metrics["total_cases"] == 3
        assert metrics["correct_cases"] == 3
        assert metrics["incorrect_cases"] == 0
        assert metrics["accuracy"] == 1.0
        for label in LABELS:
            assert metrics["per_class"][label]["precision"] == 1.0
            assert metrics["per_class"][label]["recall"] == 1.0
            assert metrics["per_class"][label]["f1"] == 1.0

    def test_precision_and_recall(self):
        outcomes = [
            {"id": "1", "expected": "approve", "predicted": "approve", "correct": True},
            {"id": "2", "expected": "approve", "predicted": "approve", "correct": True},
            {"id": "3", "expected": "approve", "predicted": "reject", "correct": False},
            {"id": "4", "expected": "reject", "predicted": "reject", "correct": True},
            {"id": "5", "expected": "reject", "predicted": "approve", "correct": False},
        ]
        metrics = compute_metrics(outcomes)
        approve = metrics["per_class"]["approve"]
        reject = metrics["per_class"]["reject"]
        assert approve["true_positives"] == 2
        assert approve["false_positives"] == 1
        assert approve["false_negatives"] == 1
        assert approve["precision"] == pytest.approx(2 / 3, abs=1e-4)
        assert approve["recall"] == pytest.approx(2 / 3, abs=1e-4)
        assert reject["true_positives"] == 1
        assert reject["false_positives"] == 1
        assert reject["false_negatives"] == 1
        assert reject["precision"] == pytest.approx(1 / 2, abs=1e-4)
        assert reject["recall"] == pytest.approx(1 / 2, abs=1e-4)
        assert metrics["accuracy"] == pytest.approx(3 / 5)

    def test_empty_outcomes(self):
        metrics = compute_metrics([])
        assert metrics["total_cases"] == 0
        assert metrics["correct_cases"] == 0
        assert metrics["accuracy"] == 0.0
        for label in LABELS:
            assert metrics["per_class"][label]["precision"] == 0.0
            assert metrics["per_class"][label]["recall"] == 0.0
            assert metrics["per_class"][label]["f1"] == 0.0


class TestCompareBaseline:
    """Tests for drift detection against the baseline metrics."""

    def _base(self, accuracy, value):
        return {
            "accuracy": accuracy,
            "per_class": {
                label: {"precision": value, "recall": value, "f1": value}
                for label in LABELS
            },
        }

    def test_identical_metrics_no_diffs(self):
        baseline = self._base(0.8, 0.8)
        current = self._base(0.8, 0.8)
        assert compare_with_baseline(current, baseline) == []

    def test_accuracy_drop_detected(self):
        baseline = self._base(0.9, 0.9)
        current = self._base(0.7, 0.9)
        diffs = compare_with_baseline(current, baseline)
        assert len(diffs) == 1
        assert diffs[0]["metric"] == "accuracy"
        assert diffs[0]["baseline"] == 0.9
        assert diffs[0]["current"] == 0.7

    def test_per_class_regression_detected(self):
        baseline = self._base(0.8, 0.8)
        current = self._base(0.8, 0.8)
        current["per_class"]["reject"]["recall"] = 0.4
        diffs = compare_with_baseline(current, baseline)
        assert any(d["metric"] == "reject.recall" for d in diffs)


class TestValidateFixtures:
    """Tests for the golden set validation rules."""

    def test_valid_fixtures(self):
        cases = [
            {"id": "a", "input": {"aid_claim": "x" * 10}, "expected": "approve"},
            {"id": "b", "input": {"aid_claim": "x" * 10}, "expected": "reject"},
            {"id": "c", "input": {"aid_claim": "x" * 10}, "expected": "ambiguous"},
        ]
        validate_fixtures(cases)

    def test_missing_category_raises(self):
        cases = [
            {"id": "a", "input": {"aid_claim": "x" * 10}, "expected": "approve"},
        ]
        with pytest.raises(ValueError, match="missing expected labels"):
            validate_fixtures(cases)

    def test_invalid_label_raises(self):
        cases = [
            {"id": "a", "input": {"aid_claim": "x" * 10}, "expected": "approve"},
            {"id": "b", "input": {"aid_claim": "x" * 10}, "expected": "reject"},
            {"id": "c", "input": {"aid_claim": "x" * 10}, "expected": "unknown"},
        ]
        with pytest.raises(ValueError, match="invalid expected label"):
            validate_fixtures(cases)

    def test_missing_input_raises(self):
        cases = [
            {"id": "a", "input": {"aid_claim": "x" * 10}, "expected": "approve"},
            {"id": "b", "input": {"aid_claim": "x" * 10}, "expected": "reject"},
            {"id": "c", "expected": "ambiguous"},
        ]
        with pytest.raises(ValueError, match="missing an 'input'"):
            validate_fixtures(cases)


class TestGoldenFixturesFile:
    """Tests for the committed golden fixtures file."""

    def test_fixtures_file_is_valid(self):
        path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "regression_harness",
            "fixtures",
            "golden_fixtures.json",
        )
        with open(path) as f:
            cases = json.load(f)
        assert len(cases) >= 9
        validate_fixtures(cases)
        counts = {label: 0 for label in LABELS}
        for case in cases:
            counts[case["expected"]] += 1
        for label in LABELS:
            assert counts[label] >= 3
