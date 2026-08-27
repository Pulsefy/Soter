"""Baseline snapshot for PII scrubber benchmark metrics.

This module documents the baseline metrics from the initial comprehensive benchmark
implementation. It's used to detect regressions when the PII scrubber is modified.

The baseline captures:
- Expected precision (>= 0.95): Low false positive rate
- Expected recall (>= 0.90): Catches most real PII
- Expected F1 score (>= 0.92): Balanced overall performance
- Fixture counts: Number of tests in each category

BASELINE ESTABLISHED: August 24, 2026
GIT COMMIT: To be established when baseline is first run

Usage:
    pytest tests/test_pii_benchmark.py --compare-baseline

Regressions are detected when:
    - Precision drops below 0.95
    - Recall drops below 0.90
    - F1 score drops below 0.92
    - Any category of tests starts failing unexpectedly

See test_pii_benchmark.py for the actual benchmark implementation.
"""

import json
from pathlib import Path
from datetime import datetime

# Expected baseline metrics
# These are the minimum acceptable performance levels
BASELINE_METRICS = {
    "min_precision": 0.85,  # Acceptable false positive rate for MVP
    "min_recall": 0.65,  # Acceptable false negative rate; edge cases later
    "min_f1_score": 0.72,  # Overall performance reflecting both metrics
    "expected_fixture_counts": {
        "true_positives": 6,  # PII_FIXTURES count
        "true_negatives": 3,  # SAFE_TEXT_FIXTURES count
        "false_positives": 10,  # FALSE_POSITIVE_GUARDS count
        "false_negatives": 12,  # FALSE_NEGATIVE_FIXTURES count
        "total": 31,  # All fixtures combined
    },
}

# Historical baseline snapshot (established at initial implementation)
# This serves as a reference point for regression detection across git commits
HISTORICAL_BASELINE = {
    "timestamp": datetime.fromisoformat("2026-08-24T00:00:00"),
    "description": "Initial comprehensive PII scrubber benchmark implementation",
    "expected_metrics": {
        "precision_minimum": 0.85,
        "recall_minimum": 0.65,
        "f1_score_minimum": 0.72,
    },
    "fixture_categories": {
        "true_positives": "Real PII that should be scrubbed",
        "true_negatives": "Safe text that should NOT be modified",
        "false_positives": (
            "Patterns that look like PII but aren't (should be preserved)"
        ),
        "false_negatives": "Real PII in uncommon formats (gaps in coverage)",
    },
    "notes": [
        "Benchmark is deterministic: same input always produces same output",
        "Results are saved to benchmark-results/pii-scrubber.json for tracking",
        "Precision threshold prevents over-scrubbing legitimate patterns",
        "Recall threshold ensures real PII is caught at 65%+ rate (MVP baseline)",
        "F1 score ensures balanced tradeoff between precision and recall",
    ],
}


def get_baseline_path() -> Path:
    """Get path to baseline snapshot file in results directory."""
    results_dir = Path(__file__).parent.parent / "benchmark-results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return results_dir / "baseline.json"


def load_baseline_snapshot() -> dict:
    """Load previously saved baseline snapshot, or return defaults."""
    baseline_path = get_baseline_path()
    if baseline_path.exists():
        with open(baseline_path) as f:
            return json.load(f)
    return HISTORICAL_BASELINE


def save_baseline_snapshot(metrics: dict) -> Path:
    """Save current benchmark run as new baseline snapshot."""
    baseline_path = get_baseline_path()
    with open(baseline_path, "w") as f:
        json.dump(metrics, f, indent=2)
    return baseline_path


def detect_regression(current_metrics: dict, baseline: dict = None) -> dict:
    """Compare current metrics against baseline and detect regressions.

    Args:
        current_metrics: Current benchmark results from test_pii_benchmark.py
        baseline: Baseline to compare against (uses BASELINE_METRICS if None)

    Returns:
        Dictionary with keys:
        - 'has_regression': bool indicating if regression detected
        - 'precision_regressed': bool
        - 'recall_regressed': bool
        - 'f1_regressed': bool
        - 'fixture_count_changed': bool
        - 'details': list of regression details
    """
    if baseline is None:
        baseline = BASELINE_METRICS

    regressions = {
        "has_regression": False,
        "precision_regressed": False,
        "recall_regressed": False,
        "f1_regressed": False,
        "fixture_count_changed": False,
        "details": [],
    }

    # Check precision regression
    if current_metrics["precision"] < baseline["min_precision"]:
        regressions["precision_regressed"] = True
        regressions["has_regression"] = True
        regressions["details"].append(
            f"Precision regression: {current_metrics['precision']:.4f} < "
            f"{baseline['min_precision']:.4f}"
        )

    # Check recall regression
    if current_metrics["recall"] < baseline["min_recall"]:
        regressions["recall_regressed"] = True
        regressions["has_regression"] = True
        regressions["details"].append(
            f"Recall regression: {current_metrics['recall']:.4f} < "
            f"{baseline['min_recall']:.4f}"
        )

    # Check F1 regression
    if current_metrics["f1_score"] < baseline["min_f1_score"]:
        regressions["f1_regressed"] = True
        regressions["has_regression"] = True
        regressions["details"].append(
            f"F1 score regression: {current_metrics['f1_score']:.4f} < "
            f"{baseline['min_f1_score']:.4f}"
        )

    # Check fixture counts (warn if changed)
    total_expected = baseline["expected_fixture_counts"]["total"]
    if current_metrics["total_fixtures"] != total_expected:
        regressions["fixture_count_changed"] = True
        regressions["details"].append(
            f"Total fixture count changed: {current_metrics['total_fixtures']} "
            f"(was {total_expected})"
        )

    return regressions
