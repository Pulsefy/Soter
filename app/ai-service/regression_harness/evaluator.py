import os
import sys
import time
import json
import argparse
from PIL import Image
from typing import List, Dict, Any, Optional

# Add the parent directory to path so we can import services
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ocr import OCRService
from regression_harness.models import (
    EvaluationSample,
    SampleResult,
    FieldEvaluation,
    RegressionReport,
    BoundingBox,
)

VERDICT_ORDER = {"pass": 0, "review": 1, "reject": 2}


class OCREvaluator:
    def __init__(self, tolerance_threshold: float = 0.8, iou_threshold: float = 0.5):
        self.ocr_service = OCRService()
        self.tolerance_threshold = tolerance_threshold
        self.iou_threshold = iou_threshold

    def evaluate_sample(self, sample: EvaluationSample, base_dir: str) -> SampleResult:
        image_path = os.path.join(base_dir, sample.image_path)
        if not os.path.exists(image_path):
            return SampleResult(
                sample_id=sample.id,
                field_evaluations=[
                    FieldEvaluation(
                        field_name="all",
                        expected_value=None,
                        actual_value=None,
                        is_match=False,
                        error_type="image_not_found",
                    )
                ],
                passed=False,
                raw_text="",
                processing_time_ms=0,
            )

        image = Image.open(image_path)
        result = self.ocr_service.process_image(image)

        field_evals = []
        all_passed = True

        # Check expected fields
        for field_name, expected_value in sample.expected_fields.items():
            actual_match = result.fields.get(field_name)

            if not actual_match:
                field_evals.append(
                    FieldEvaluation(
                        field_name=field_name,
                        expected_value=expected_value,
                        actual_value=None,
                        is_match=False,
                        error_type="missing_field",
                    )
                )
                all_passed = False
            else:
                actual_value = actual_match.value
                is_match = self._compare_values(expected_value, actual_value)

                error_type = None
                if not is_match:
                    error_type = "incorrect_value"
                    all_passed = False

                # Note: Simplified bbox check as current OCRService doesn't return bboxes per field in OCRResult yet.
                # If it did, we would use _calculate_iou here.

                field_evals.append(
                    FieldEvaluation(
                        field_name=field_name,
                        expected_value=expected_value,
                        actual_value=actual_value,
                        is_match=is_match,
                        error_type=error_type,
                        confidence=actual_match.confidence,
                    )
                )

        # Check for unexpected fields
        for field_name in result.fields.keys():
            if field_name not in sample.expected_fields:
                field_evals.append(
                    FieldEvaluation(
                        field_name=field_name,
                        expected_value=None,
                        actual_value=result.fields[field_name].value,
                        is_match=False,
                        error_type="unexpected_field",
                    )
                )

        return SampleResult(
            sample_id=sample.id,
            field_evaluations=field_evals,
            passed=all_passed,
            raw_text=result.raw_text,
            processing_time_ms=result.processing_time_ms,
        )

    def _calculate_iou(self, box1: BoundingBox, box2: BoundingBox) -> float:
        x1 = max(box1.x, box2.x)
        y1 = max(box1.y, box2.y)
        x2 = min(box1.x + box1.width, box2.x + box2.width)
        y2 = min(box1.y + box1.height, box2.y + box2.height)

        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = box1.width * box1.height
        area2 = box2.width * box2.height
        union = area1 + area2 - intersection

        return intersection / union if union > 0 else 0

    def _compare_values(self, expected: str, actual: str) -> bool:
        if not expected or not actual:
            return expected == actual
        norm_expected = expected.strip().lower()
        norm_actual = actual.strip().lower()
        return norm_expected == norm_actual

    def run_suite(
        self, samples: List[EvaluationSample], base_dir: str
    ) -> RegressionReport:
        results = []
        error_counts = {
            "missing_field": 0,
            "incorrect_value": 0,
            "unexpected_field": 0,
            "image_not_found": 0,
            "low_confidence": 0,
            "bbox_mismatch": 0,
        }

        for sample in samples:
            res = self.evaluate_sample(sample, base_dir)
            results.append(res)

            for eval_item in res.field_evaluations:
                if eval_item.error_type in error_counts:
                    error_counts[eval_item.error_type] += 1

                if (
                    eval_item.is_match
                    and eval_item.confidence < self.tolerance_threshold
                ):
                    error_counts["low_confidence"] += 1

        passed_count = sum(1 for r in results if r.passed)
        total_count = len(samples)
        accuracy = (passed_count / total_count * 100) if total_count > 0 else 0

        return RegressionReport(
            total_samples=total_count,
            passed_samples=passed_count,
            failed_samples=total_count - passed_count,
            accuracy_percentage=accuracy,
            error_counts=error_counts,
            sample_results=results,
        )

    def _derive_verdict(self, result: SampleResult) -> str:
        if result.passed:
            return "pass"
        if any(
            e.error_type in ("missing_field", "image_not_found")
            for e in result.field_evaluations
        ):
            return "reject"
        return "review"

    def dry_run(
        self,
        samples: List[EvaluationSample],
        base_dir: str,
        active_results: Dict[str, SampleResult],
    ) -> Dict[str, Any]:
        """Run draft prompt against samples and diff verdicts vs active results."""
        draft_results: Dict[str, SampleResult] = {}
        verdict_changes = []
        score_drift = []

        for sample in samples:
            res = self.evaluate_sample(sample, base_dir)
            draft_results[sample.id] = res
            draft_verdict = self._derive_verdict(res)

            active = active_results.get(sample.id)
            if active is None:
                verdict_changes.append(
                    {
                        "sample_id": sample.id,
                        "active_verdict": None,
                        "draft_verdict": draft_verdict,
                        "reason": "no_active_result",
                    }
                )
                continue

            active_verdict = self._derive_verdict(active)
            if active_verdict != draft_verdict:
                verdict_changes.append(
                    {
                        "sample_id": sample.id,
                        "active_verdict": active_verdict,
                        "draft_verdict": draft_verdict,
                        "reason": "verdict_changed",
                    }
                )
            else:
                active_matches = sum(
                    1 for e in active.field_evaluations if e.is_match
                )
                draft_matches = sum(
                    1 for e in res.field_evaluations if e.is_match
                )
                if active_matches != draft_matches:
                    score_drift.append(
                        {
                            "sample_id": sample.id,
                            "active_matches": active_matches,
                            "draft_matches": draft_matches,
                        }
                    )

        return {
            "total_samples": len(samples),
            "verdict_changes": verdict_changes,
            "score_drift": score_drift,
            "draft_results": draft_results,
        }

    def format_dry_run_report(self, diff: Dict[str, Any]) -> str:
        lines = []
        lines.append("=" * 60)
        lines.append("DRY-RUN PROMPT DIFF REPORT")
        lines.append("=" * 60)
        lines.append(f"Total samples: {diff['total_samples']}")
        lines.append(f"Verdict changes: {len(diff['verdict_changes'])}")
        lines.append(f"Score drift (same verdict): {len(diff['score_drift'])}")
        lines.append("")

        if diff["verdict_changes"]:
            lines.append("!! VERDICT CHANGES (high priority) !!")
            for change in diff["verdict_changes"]:
                lines.append(
                    f"  {change['sample_id']}: "
                    f"{change['active_verdict']} -> {change['draft_verdict']} "
                    f"({change['reason']})"
                )
            lines.append("")

        if diff["score_drift"]:
            lines.append("Minor score drift (verdict unchanged):")
            for drift in diff["score_drift"]:
                lines.append(
                    f"  {drift['sample_id']}: "
                    f"{drift['active_matches']} -> {drift['draft_matches']} matches"
                )
            lines.append("")

        return "\n".join(lines)


def _load_active_results(path: str) -> Dict[str, SampleResult]:
    with open(path, "r") as f:
        data = json.load(f)
    results: Dict[str, SampleResult] = {}
    for item in data.get("sample_results", []):
        results[item["sample_id"]] = SampleResult(**item)
    return results


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Dry-run a draft prompt against a fixture subset and diff "
        "verdicts against the active prompt's results."
    )
    parser.add_argument("--samples", required=True, help="Path to samples JSON")
    parser.add_argument("--base-dir", required=True, help="Fixture base directory")
    parser.add_argument(
        "--active-results",
        required=True,
        help="Path to active prompt's RegressionReport JSON",
    )
    parser.add_argument(
        "--limit", type=int, default=10, help="Max representative samples to run"
    )
    args = parser.parse_args(argv)

    with open(args.samples, "r") as f:
        samples_data = json.load(f)
    samples = [EvaluationSample(**s) for s in samples_data][: args.limit]

    active_results = _load_active_results(args.active_results)
    evaluator = OCREvaluator()
    diff = evaluator.dry_run(samples, args.base_dir, active_results)
    print(evaluator.format_dry_run_report(diff))
    return 0


if __name__ == "__main__":
    sys.exit(main())
