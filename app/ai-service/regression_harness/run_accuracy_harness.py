"""Compares verification output on golden cases against a committed baseline."""

import argparse
import json
import os
import sys
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from regression_harness.calibration import (
    DEFAULT_CALIBRATION_REPORT,
    compute_calibration,
    write_calibration_report,
)

if TYPE_CHECKING:
    from regression_harness.deterministic_provider import (
        DeterministicVerificationProvider,
    )

LABELS = ["approve", "reject", "ambiguous"]
BASELINE_TOLERANCE = 1e-6
MISCALIBRATION_EXIT_CODE = 3


def load_fixtures(fixtures_path: str) -> List[Dict[str, Any]]:
    """Read the golden set from a JSON file and return its cases."""
    with open(fixtures_path, "r") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data.get("cases", [])
    return data


def validate_fixtures(cases: List[Dict[str, Any]]) -> None:
    """Check every case is well formed and all label categories are covered."""
    expected_labels = set()
    for case in cases:
        case_id = case.get("id")
        expected = case.get("expected")
        if not case_id:
            raise ValueError("fixture case is missing an 'id'")
        if expected not in LABELS:
            raise ValueError(
                f"case '{case_id}' has invalid expected label '{expected}'"
            )
        if not case.get("input"):
            raise ValueError(f"case '{case_id}' is missing an 'input' object")
        expected_labels.add(expected)
    missing = [label for label in LABELS if label not in expected_labels]
    if missing:
        raise ValueError("golden set is missing expected labels: " + ", ".join(missing))


def run_suite(
    cases: List[Dict[str, Any]], provider: "DeterministicVerificationProvider"
) -> List[Dict[str, Any]]:
    """Run every case through the provider and return per-case outcomes."""
    outcomes = []
    for case in cases:
        inp = case["input"]
        prediction = provider.predict(
            aid_claim=inp["aid_claim"],
            supporting_evidence=inp.get("supporting_evidence"),
            context_factors=inp.get("context_factors"),
        )
        expected = case["expected"]
        predicted = prediction["label"]
        outcomes.append(
            {
                "id": case["id"],
                "expected": expected,
                "predicted": predicted,
                "verdict": prediction.get("verdict"),
                "confidence": prediction.get("confidence"),
                "correct": expected == predicted,
            }
        )
    return outcomes


def compute_metrics(outcomes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Turn outcomes into overall accuracy and per-class precision, recall, and F1."""
    counts = {label: {"tp": 0, "fp": 0, "fn": 0} for label in LABELS}
    correct = 0
    for outcome in outcomes:
        expected = outcome["expected"]
        predicted = outcome["predicted"]
        if outcome["correct"]:
            correct += 1
        for label in LABELS:
            if predicted == label:
                if expected == label:
                    counts[label]["tp"] += 1
                else:
                    counts[label]["fp"] += 1
            elif expected == label:
                counts[label]["fn"] += 1
    per_class = {}
    for label in LABELS:
        tp = counts[label]["tp"]
        fp = counts[label]["fp"]
        fn = counts[label]["fn"]
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )
        per_class[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
        }
    total = len(outcomes)
    return {
        "total_cases": total,
        "correct_cases": correct,
        "incorrect_cases": total - correct,
        "accuracy": round(correct / total, 4) if total else 0.0,
        "per_class": per_class,
    }


def print_summary(metrics: Dict[str, Any], outcomes: List[Dict[str, Any]]) -> None:
    """Print the summary table and per-case outcomes to stdout."""
    print("\n" + "=" * 68)
    print(" GOLDEN-SET ACCURACY HARNESS")
    print("=" * 68)
    print(f"Total cases:      {metrics['total_cases']}")
    print(f"Correct cases:    {metrics['correct_cases']}")
    print(f"Incorrect cases:  {metrics['incorrect_cases']}")
    print(f"Overall accuracy: {metrics['accuracy']:.4f}")
    print("-" * 68)
    print("Per-class metrics (precision / recall / f1):")
    print(
        f"  {'label':<10} {'precision':>9} {'recall':>9} {'f1':>9} "
        f"{'tp':>3} {'fp':>3} {'fn':>3}"
    )
    for label in LABELS:
        m = metrics["per_class"][label]
        print(
            f"  {label:<10} {m['precision']:>9.4f} {m['recall']:>9.4f} {m['f1']:>9.4f} "
            f"{m['true_positives']:>3} {m['false_positives']:>3} "
            f"{m['false_negatives']:>3}"
        )
    print("-" * 68)
    print("Per-case outcomes:")
    print(f"  {'id':<14} {'expected':<10} {'predicted':<10} {'verdict':<14} {'result'}")
    for outcome in outcomes:
        status = "PASS" if outcome["correct"] else "FAIL"
        verdict = str(outcome.get("verdict") or "-")
        print(
            f"  {outcome['id']:<14} {outcome['expected']:<10} "
            f"{outcome['predicted']:<10} {verdict:<14} {status}"
        )
    print("=" * 68 + "\n")


def print_calibration(calibration: Dict[str, Any]) -> None:
    """Print the confidence calibration table and flag miscalibrated bands."""
    print("-" * 68)
    print(" CONFIDENCE CALIBRATION")
    print("-" * 68)
    print(f"  {'band':<22} {'cases':>5} {'acc':>7} " f"{'conf':>7} {'gap':>8}  status")
    for band in calibration["bands"]:
        print(
            f"  {band['band']:<22} {band['count']:>5} "
            f"{band['accuracy']:>7.4f} {band['mean_confidence']:>7.4f} "
            f"{band['gap']:>+8.4f}  {band['status']}"
        )
    print(
        f"  Expected calibration error: "
        f"{calibration['expected_calibration_error']:.4f}"
    )
    flagged = calibration.get("flagged_bands", [])
    if flagged:
        print("  MISCALIBRATION FLAGGED:")
        for flag in flagged:
            print(
                f"    - {flag['band']}: accuracy {flag['accuracy']:.4f} vs "
                f"stated confidence {flag['mean_confidence']:.4f} "
                f"({flag['direction']}, gap {flag['gap']:+.4f})"
            )
    else:
        print("  No band exceeds the miscalibration tolerance.")
    print("-" * 68 + "\n")


def load_baseline(baseline_path: str) -> Optional[Dict[str, Any]]:
    """Read the baseline metrics, or return None when the file is missing."""
    if not os.path.exists(baseline_path):
        return None
    with open(baseline_path, "r") as f:
        return json.load(f)


def compare_with_baseline(
    current: Dict[str, Any],
    baseline: Dict[str, Any],
    tolerance: float = BASELINE_TOLERANCE,
) -> List[Dict[str, Any]]:
    """Return metrics that dropped past the tolerance from the baseline."""
    diffs = []
    if current["accuracy"] < baseline["accuracy"] - tolerance:
        diffs.append(
            {
                "metric": "accuracy",
                "baseline": baseline["accuracy"],
                "current": current["accuracy"],
            }
        )
    for label in LABELS:
        base = baseline.get("per_class", {}).get(label, {})
        curr = current.get("per_class", {}).get(label, {})
        for metric in ("precision", "recall", "f1"):
            base_value = base.get(metric, 0.0)
            curr_value = curr.get(metric, 0.0)
            if curr_value < base_value - tolerance:
                diffs.append(
                    {
                        "metric": f"{label}.{metric}",
                        "baseline": base_value,
                        "current": curr_value,
                    }
                )
    return diffs


def main(argv: Optional[List[str]] = None) -> int:
    """Entry point that runs the harness and returns an exit code."""
    parser = argparse.ArgumentParser(
        description="Golden-set accuracy harness for humanitarian verification"
    )
    parser.add_argument(
        "--fixtures",
        default="fixtures/golden_fixtures.json",
        help="Path to the golden-set fixture file",
    )
    parser.add_argument(
        "--baseline",
        default="baseline_metrics.json",
        help="Path to the baseline metrics JSON file",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Write current metrics as the new baseline",
    )
    parser.add_argument(
        "--output",
        help="Optional path to write a machine-readable JSON report",
    )
    parser.add_argument(
        "--calibration-report",
        default=DEFAULT_CALIBRATION_REPORT,
        help="Path to write the committed confidence calibration Markdown report",
    )
    parser.add_argument(
        "--fail-on-miscalibration",
        action="store_true",
        help=(
            "Exit with code 3 when a confidence band is miscalibrated "
            "(off by default so the daily regression run is not broken by "
            "a known calibration gap)"
        ),
    )
    args = parser.parse_args(argv)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    fixtures_path = (
        args.fixtures
        if os.path.isabs(args.fixtures)
        else os.path.join(base_dir, args.fixtures)
    )
    baseline_path = (
        args.baseline
        if os.path.isabs(args.baseline)
        else os.path.join(base_dir, args.baseline)
    )

    try:
        cases = load_fixtures(fixtures_path)
        validate_fixtures(cases)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}")
        return 2

    from regression_harness.deterministic_provider import (
        DeterministicVerificationProvider,
    )

    provider = DeterministicVerificationProvider()
    outcomes = run_suite(cases, provider)
    metrics = compute_metrics(outcomes)
    calibration = compute_calibration(outcomes)

    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result = {
        "generated_at": generated_at,
        "provider": "deterministic-fixture",
        "configuration": {
            "prompt_execution": "current HumanitarianPromptEngine code",
            "model_execution": "FixtureProvider (offline deterministic mode)",
        },
        "fixture_count": len(cases),
        "metrics": metrics,
        "calibration": calibration,
        "cases": outcomes,
    }

    print_summary(metrics, outcomes)
    print_calibration(calibration)

    if args.calibration_report:
        try:
            written = write_calibration_report(
                calibration,
                args.calibration_report,
                generated_at=generated_at,
                fixture_count=len(cases),
                overall_accuracy=metrics["accuracy"],
            )
            print(f"Calibration report written to {written}")
        except OSError as exc:
            print(f"WARNING: could not write calibration report: {exc}")

    baseline = load_baseline(baseline_path)
    diffs = compare_with_baseline(metrics, baseline) if baseline else []
    result["baseline"] = baseline
    result["regressions"] = diffs
    result["status"] = "regression" if diffs else "passed"

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Report written to {args.output}")

    exit_code = 0
    if args.update_baseline:
        with open(baseline_path, "w") as f:
            json.dump(metrics, f, indent=2)
        print(f"Baseline written to {baseline_path}")
    elif baseline is None:
        print(
            "WARNING: baseline metrics not found. "
            "Run with --update-baseline to create a baseline."
        )
    elif diffs:
        print("METRIC REGRESSION DETECTED - current run differs from baseline:")
        for diff in diffs:
            print(
                f"  {diff['metric']}: baseline={diff['baseline']} "
                f"current={diff['current']}"
            )
        print("Run with --update-baseline to accept the new metrics as baseline.")
        exit_code = 1
    else:
        print("Metrics match baseline. No regression detected.")

    if args.fail_on_miscalibration and not calibration["is_calibrated"]:
        print(
            "CONFIDENCE MISCALIBRATION DETECTED - "
            f"{len(calibration['flagged_bands'])} band(s) exceed the "
            f"{calibration['tolerance']} tolerance:"
        )
        for flag in calibration["flagged_bands"]:
            print(
                f"  {flag['band']}: accuracy={flag['accuracy']} "
                f"mean_confidence={flag['mean_confidence']} "
                f"({flag['direction']})"
            )
        exit_code = MISCALIBRATION_EXIT_CODE

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
