"""PII scrubber regression benchmark suite.

This benchmark tests the PII scrubber against a comprehensive fixture set and calculates:
- Precision: true positives / (true positives + false positives)
- Recall: true positives / (true positives + false negatives)
- F1 Score: 2 * (precision * recall) / (precision + recall)

The benchmark is deterministic (fixed seed, no randomness) and results are reproducible
across local and CI runs. Results are saved to benchmark-results/pii-scrubber.json for
regression detection across revisions.
"""

import json
import pytest
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
from services.pii_scrubber import PIIScrubberService
from tests.pii_fixtures import (
    PII_FIXTURES,
    SAFE_TEXT_FIXTURES,
    FALSE_POSITIVE_GUARDS,
    FALSE_NEGATIVE_FIXTURES,
    ALL_FIXTURES,
)  # noqa: E401


class PIIScrubberBenchmark:
    """Benchmark suite for PII scrubber with metrics calculation."""

    # Minimum acceptable performance thresholds for regression detection
    # Current performance baseline (as of test/767-pii-scrubber-regression-benchmarks):
    # - Precision: 0.8571 (85.71% of detected PII is actually PII)
    #   Reason: Some false positives like error codes, file paths match
    #   phone/ID patterns
    # - Recall: 0.6667 (66.67% of real PII is detected)
    #   Reason: Limited detection for edge cases - unusual TLDs,
    #   international formats, accented names, ISO date formats, and IDs
    #   with spaces need improvement
    # - F1: 0.75 (weighted average of precision and recall)
    #   Reason: Reflects tradeoff between false positives and false negatives
    #
    # These thresholds are conservative and prevent regressions while
    # allowing incremental improvements. They reflect production constraints:
    # - Privacy is critical: false negatives (missed PII) are acceptable
    #   if they mean fewer legitimate patterns are incorrectly flagged
    #   (false positives)
    # - Most real-world PII follows standard formats (basic emails,
    #   standard phone patterns)
    # - Complex edge cases (accents, unusual separators) are lower priority
    #   for MVP
    MIN_PRECISION = 0.85  # Acceptable false positive rate for MVP
    MIN_RECALL = 0.65  # Acceptable false negative rate; edge cases later
    MIN_F1 = 0.72  # Overall performance threshold reflecting both metrics

    def __init__(self):
        self.service = PIIScrubberService()
        self.metrics = {
            "true_positives": 0,
            "false_positives": 0,
            "true_negatives": 0,
            "false_negatives": 0,
            "precision": 0.0,
            "recall": 0.0,
            "f1_score": 0.0,
            "total_fixtures": 0,
            "fixture_breakdown": {},
            "timestamp": datetime.utcnow().isoformat(),
            "git_commit": self._get_git_commit(),
        }

    def run_all_benchmarks(self) -> Dict:
        """Run all benchmark suites and return aggregated metrics."""
        # Test true positives: PII should be detected and scrubbed
        self._benchmark_true_positives()

        # Test true negatives: Safe text should NOT be scrubbed
        self._benchmark_true_negatives()

        # Test false positives: Common patterns that look like PII but aren't
        self._benchmark_false_positives()

        # Test false negatives: Real PII that might be missed
        self._benchmark_false_negatives()

        # Calculate metrics
        self._calculate_metrics()

        return self.metrics

    def _benchmark_true_positives(self):
        """Test that all real PII is detected and scrubbed.

        A true positive occurs when:
        - Input contains real PII
        - Scrubber detects and replaces it with correct token
        """
        category = "true_positives"
        self.metrics["fixture_breakdown"][category] = {
            "passed": 0,
            "failed": 0,
            "details": [],
        }

        for fixture in PII_FIXTURES:
            name = fixture["name"]
            text = fixture["text"]
            expected_tokens = fixture["expected_tokens"]
            min_count = fixture.get("min_count", 1)

            result = self.service.anonymize(text)
            anonymized = result["anonymized_text"]
            token_counts = result["token_counts"]
            total_redacted = sum(token_counts.values())

            passed = True
            failures = []

            # Check that all expected tokens are present
            for token in expected_tokens:
                if token not in anonymized:
                    passed = False
                    failures.append(f"Expected token {token} not found")

            # Check minimum redaction count
            if total_redacted < min_count:
                passed = False
                msg = f"Expected {min_count} redactions, got {total_redacted}"
                failures.append(msg)

            if passed:
                self.metrics["true_positives"] += 1
                self.metrics["fixture_breakdown"][category]["passed"] += 1
            else:
                self.metrics["fixture_breakdown"][category]["failed"] += 1

            self.metrics["fixture_breakdown"][category]["details"].append(
                {
                    "name": name,
                    "passed": passed,
                    "failures": failures,
                    "redaction_count": total_redacted,
                }
            )

    def _benchmark_true_negatives(self):
        """Test that safe text is NOT over-redacted.

        A true negative occurs when:
        - Input contains no PII
        - Scrubber does not modify the text
        """
        category = "true_negatives"
        self.metrics["fixture_breakdown"][category] = {
            "passed": 0,
            "failed": 0,
            "details": [],
        }

        for fixture in SAFE_TEXT_FIXTURES:
            name = fixture["name"]
            text = fixture["text"]
            should_not_contain = fixture["should_not_contain"]

            result = self.service.anonymize(text)
            anonymized = result["anonymized_text"]

            passed = True
            failures = []

            # Text should remain unchanged
            if anonymized != text:
                passed = False
                failures.append("Text was modified when it should not be")

            # Check that tokens are NOT present
            for token in should_not_contain:
                if token in anonymized:
                    passed = False
                    failures.append(f"Unexpected token {token} found (false positive)")

            if passed:
                self.metrics["true_negatives"] += 1
                self.metrics["fixture_breakdown"][category]["passed"] += 1
            else:
                self.metrics["fixture_breakdown"][category]["failed"] += 1

            self.metrics["fixture_breakdown"][category]["details"].append(
                {"name": name, "passed": passed, "failures": failures}
            )

    def _benchmark_false_positives(self):
        """Test that common patterns NOT PII are not over-scrubbed.

        A false positive prevention check ensures:
        - Input contains legitimate non-PII content that looks like PII
        - Scrubber correctly preserves it
        """
        category = "false_positives"
        self.metrics["fixture_breakdown"][category] = {
            "passed": 0,
            "failed": 0,
            "details": [],
        }

        for guard in FALSE_POSITIVE_GUARDS:
            name = guard["name"]
            text = guard["text"]
            should_not_redact = guard["should_not_redact"]

            result = self.service.anonymize(text)
            anonymized = result["anonymized_text"]

            passed = should_not_redact in anonymized
            if passed:
                self.metrics["fixture_breakdown"][category]["passed"] += 1
            else:
                self.metrics["fixture_breakdown"][category]["failed"] += 1
                self.metrics["false_positives"] += 1

            self.metrics["fixture_breakdown"][category]["details"].append(
                {
                    "name": name,
                    "passed": passed,
                    "phrase": should_not_redact,
                    "found_in_output": should_not_redact in anonymized,
                }
            )

    def _benchmark_false_negatives(self):
        """Test that real PII missed by current patterns is ideally caught.

        A false negative detection check identifies:
        - Input contains real PII that patterns might miss
        - Whether scrubber successfully catches it
        - Current coverage gaps for future improvement
        """
        category = "false_negatives"
        self.metrics["fixture_breakdown"][category] = {
            "passed": 0,
            "failed": 0,
            "details": [],
        }

        for fixture in FALSE_NEGATIVE_FIXTURES:
            name = fixture["name"]
            text = fixture["text"]
            should_contain = fixture.get("should_contain")
            original_text = fixture.get("original_text", "")

            result = self.service.anonymize(text)
            anonymized = result["anonymized_text"]
            token_counts = result["token_counts"]
            total_redacted = sum(token_counts.values())

            passed = (
                should_contain in anonymized if should_contain else total_redacted > 0
            )

            if passed:
                self.metrics["fixture_breakdown"][category]["passed"] += 1
            else:
                self.metrics["fixture_breakdown"][category]["failed"] += 1
                self.metrics["false_negatives"] += 1

            self.metrics["fixture_breakdown"][category]["details"].append(
                {
                    "name": name,
                    "passed": passed,
                    "expected_token": should_contain,
                    "original_pii": original_text,
                    "redaction_found": total_redacted > 0,
                }
            )

    def _calculate_metrics(self):
        """Calculate precision, recall, and F1 score from benchmark results."""
        tp = self.metrics["true_positives"]
        fp = self.metrics["false_positives"]
        tn = self.metrics["true_negatives"]
        fn = self.metrics["false_negatives"]

        # Precision: How many detected PII instances were actually PII?
        # tp / (tp + fp)
        if (tp + fp) > 0:
            precision = tp / (tp + fp)
        else:
            precision = 0.0

        # Recall: How many actual PII instances were detected?
        # tp / (tp + fn)
        if (tp + fn) > 0:
            recall = tp / (tp + fn)
        else:
            recall = 0.0

        # F1 Score: Harmonic mean of precision and recall
        if (precision + recall) > 0:
            f1 = 2 * (precision * recall) / (precision + recall)
        else:
            f1 = 0.0

        self.metrics["precision"] = round(precision, 4)
        self.metrics["recall"] = round(recall, 4)
        self.metrics["f1_score"] = round(f1, 4)
        self.metrics["total_fixtures"] = (
            len(PII_FIXTURES)
            + len(SAFE_TEXT_FIXTURES)
            + len(FALSE_POSITIVE_GUARDS)
            + len(FALSE_NEGATIVE_FIXTURES)
        )

    def _get_git_commit(self) -> str:
        """Get current git commit hash if available."""
        try:
            import subprocess

            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=5,
                cwd=str(Path(__file__).parent.parent.parent),
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return "unknown"

    def save_results(self, output_dir: str = "benchmark-results") -> Path:
        """Save benchmark results to JSON file for regression tracking."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        results_file = output_path / "pii-scrubber.json"
        with open(results_file, "w") as f:
            json.dump(self.metrics, f, indent=2)

        return results_file


class TestPIIScrubberBenchmark:
    """Pytest test class for running and validating benchmark metrics."""

    @pytest.fixture(autouse=True)
    def setup_benchmark(self):
        """Initialize benchmark before each test."""
        self.benchmark = PIIScrubberBenchmark()
        self.metrics = self.benchmark.run_all_benchmarks()

    def test_benchmark_precision_meets_minimum(self):
        """Ensure precision >= 0.85 (acceptable false positive rate)."""
        precision = self.metrics["precision"]
        min_precision = PIIScrubberBenchmark.MIN_PRECISION
        msg = f"Precision {precision} below {min_precision}"
        assert precision >= min_precision, msg

    def test_benchmark_recall_meets_minimum(self):
        """Ensure recall >= 0.65 (acceptable false negative rate)."""
        recall = self.metrics["recall"]
        min_recall = PIIScrubberBenchmark.MIN_RECALL
        msg = f"Recall {recall} below {min_recall}"
        assert recall >= min_recall, msg

    def test_benchmark_f1_meets_minimum(self):
        """Ensure F1 score >= 0.72 (balanced performance)."""
        f1 = self.metrics["f1_score"]
        min_f1 = PIIScrubberBenchmark.MIN_F1
        msg = f"F1 {f1} below {min_f1}"
        assert f1 >= min_f1, msg

    def test_true_positives_fully_detected(self):
        """All true positive fixtures should be detected."""
        fp_details = self.metrics["fixture_breakdown"]["true_positives"]["details"]
        failed = [d for d in fp_details if not d["passed"]]

        assert len(failed) == 0, f"TP detection failed: {len(failed)} failures"

    def test_true_negatives_fully_preserved(self):
        """All true negative fixtures should NOT be scrubbed."""
        tn_details = self.metrics["fixture_breakdown"]["true_negatives"]["details"]
        failed = [d for d in tn_details if not d["passed"]]

        assert len(failed) == 0, f"TN preservation failed: {len(failed)} failures"

    def test_false_positive_guards_all_pass(self):
        """All false positive guards should prevent over-scrubbing."""
        fp_guards = self.metrics["fixture_breakdown"]["false_positives"]["details"]
        failed = [d for d in fp_guards if not d["passed"]]

        assert len(failed) == 0, f"False positive guards failed: {len(failed)} failures"

    def test_benchmark_is_deterministic(self):
        """Verify benchmark results are identical across runs.

        Run the benchmark twice and compare to ensure no randomness.
        """
        benchmark2 = PIIScrubberBenchmark()
        metrics2 = benchmark2.run_all_benchmarks()

        # Compare key metrics (ignore timestamp and git_commit which differ)
        assert self.metrics["precision"] == metrics2["precision"]
        assert self.metrics["recall"] == metrics2["recall"]
        assert self.metrics["f1_score"] == metrics2["f1_score"]
        assert self.metrics["true_positives"] == metrics2["true_positives"]
        assert self.metrics["true_negatives"] == metrics2["true_negatives"]
        assert self.metrics["false_positives"] == metrics2["false_positives"]
        assert self.metrics["false_negatives"] == metrics2["false_negatives"]

    def test_benchmark_results_saved_to_file(self):
        """Benchmark results should be saved to JSON file for tracking."""
        output_file = self.benchmark.save_results("benchmark-results")

        assert output_file.exists(), "Benchmark results file not created"

        # Verify file contains valid JSON
        with open(output_file) as f:
            saved_metrics = json.load(f)

        assert saved_metrics["precision"] == self.metrics["precision"]
        assert saved_metrics["total_fixtures"] == self.metrics["total_fixtures"]

    def test_benchmark_has_all_required_fields(self):
        """Benchmark results should contain all required fields."""
        required_fields = [
            "true_positives",
            "false_positives",
            "true_negatives",
            "false_negatives",
            "precision",
            "recall",
            "f1_score",
            "total_fixtures",
            "fixture_breakdown",
            "timestamp",
            "git_commit",
        ]

        for field in required_fields:
            assert field in self.metrics, f"Missing '{field}' in results"


# Fixture for access to benchmark outside of test class
@pytest.fixture(scope="session")
def pii_benchmark():
    """Session-scoped fixture providing benchmark instance."""
    benchmark = PIIScrubberBenchmark()
    benchmark.run_all_benchmarks()
    return benchmark
