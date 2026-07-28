#!/usr/bin/env python3
"""
PII Scrubber Regression Benchmark
==================================
Measures the accuracy and throughput of the PII scrubber against the fixture
set in tests/fixtures/.

Usage
-----
    # Print results to stdout (default)
    python3 tests/benchmark_pii.py

    # Write JSON report to a file (suitable for CI artifact upload)
    python3 tests/benchmark_pii.py --output benchmark_report.json

    # Fail with exit code 1 if accuracy drops below a threshold (0-100)
    python3 tests/benchmark_pii.py --min-accuracy 95

    # Combine flags
    python3 tests/benchmark_pii.py --output report.json --min-accuracy 95

Exit codes
----------
    0 - all assertions met (or no --min-accuracy flag given)
    1 - accuracy below --min-accuracy threshold
    2 - fixture files not found
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure repo root is on the path so ``scrubber`` is importable regardless of
# the working directory the script is invoked from.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from scrubber import scrub_pii  # noqa: E402  (import after path manipulation)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_FIXTURES_DIR = _REPO_ROOT / "tests" / "fixtures"
_INPUTS_PATH = _FIXTURES_DIR / "pii_inputs.json"
_EXPECTED_PATH = _FIXTURES_DIR / "expected_outputs.json"

# Number of repetitions used to measure throughput (higher = more stable)
_THROUGHPUT_REPS = 1000


# ---------------------------------------------------------------------------
# Core benchmark logic
# ---------------------------------------------------------------------------


def load_fixtures() -> tuple[list[dict], list[dict]]:
    for path in (_INPUTS_PATH, _EXPECTED_PATH):
        if not path.exists():
            print(f"ERROR: fixture file not found: {path}", file=sys.stderr)
            sys.exit(2)

    with _INPUTS_PATH.open() as f:
        inputs: list[dict] = json.load(f)
    with _EXPECTED_PATH.open() as f:
        expected: list[dict] = json.load(f)

    return inputs, expected


def run_benchmark(inputs: list[dict], expected: list[dict]) -> dict[str, Any]:
    """Run correctness check and throughput test; return a result dict."""

    # ------------------------------------------------------------------
    # 1. Correctness pass
    # ------------------------------------------------------------------
    correct = 0
    total = len(inputs)
    per_case: list[dict] = []

    for inp, exp in zip(inputs, expected):
        actual = scrub_pii(inp["input"])
        passed = actual == exp["expected"]
        if passed:
            correct += 1

        per_case.append(
            {
                "name": inp["name"],
                "input": inp["input"],
                "expected": exp["expected"],
                "actual": actual,
                "pass": passed,
            }
        )

    accuracy_pct = round(100 * correct / total, 2) if total else 0.0

    # ------------------------------------------------------------------
    # 2. Throughput pass (run all inputs _THROUGHPUT_REPS times)
    # ------------------------------------------------------------------
    all_texts = [item["input"] for item in inputs]

    start = time.perf_counter()
    for _ in range(_THROUGHPUT_REPS):
        for text in all_texts:
            scrub_pii(text)
    elapsed_s = time.perf_counter() - start

    total_calls = _THROUGHPUT_REPS * total
    calls_per_sec = round(total_calls / elapsed_s, 1)
    avg_ms = round(elapsed_s / total_calls * 1000, 4)

    # ------------------------------------------------------------------
    # 3. Category breakdown
    # ------------------------------------------------------------------
    false_positives = [c for c in per_case if "false-positive" in c["name"]]
    false_negatives = [c for c in per_case if "false-negative" in c["name"]]
    edge_cases = [c for c in per_case if "edge" in c["name"]]
    basic_cases = [
        c for c in per_case
        if not any(k in c["name"] for k in ("false-positive", "false-negative", "edge"))
    ]

    def _cat_summary(cases: list[dict]) -> dict:
        n = len(cases)
        passed = sum(1 for c in cases if c["pass"])
        return {"total": n, "passed": passed, "failed": n - passed}

    return {
        "summary": {
            "total_cases": total,
            "passed": correct,
            "failed": total - correct,
            "accuracy_pct": accuracy_pct,
        },
        "throughput": {
            "repetitions": _THROUGHPUT_REPS,
            "total_calls": total_calls,
            "elapsed_seconds": round(elapsed_s, 4),
            "calls_per_second": calls_per_sec,
            "avg_latency_ms": avg_ms,
        },
        "categories": {
            "basic": _cat_summary(basic_cases),
            "false_positive": _cat_summary(false_positives),
            "false_negative": _cat_summary(false_negatives),
            "edge": _cat_summary(edge_cases),
        },
        "per_case": per_case,
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def print_report(report: dict[str, Any]) -> None:
    s = report["summary"]
    t = report["throughput"]
    cats = report["categories"]

    print()
    print("=" * 60)
    print("  PII Scrubber Regression Benchmark")
    print("=" * 60)
    print()
    print(f"  Total cases   : {s['total_cases']}")
    print(f"  Passed        : {s['passed']}")
    print(f"  Failed        : {s['failed']}")
    print(f"  Accuracy      : {s['accuracy_pct']}%")
    print()
    print("  Category breakdown:")
    for cat, data in cats.items():
        status = "✓" if data["failed"] == 0 else "✗"
        print(
            f"    {status} {cat:<20} "
            f"{data['passed']}/{data['total']} passed"
        )
    print()
    print("  Throughput:")
    print(f"    Calls       : {t['total_calls']:,} ({t['repetitions']}x each fixture)")
    print(f"    Elapsed     : {t['elapsed_seconds']} s")
    print(f"    Throughput  : {t['calls_per_second']:,} calls/sec")
    print(f"    Avg latency : {t['avg_latency_ms']} ms/call")
    print()

    failures = [c for c in report["per_case"] if not c["pass"]]
    if failures:
        print("  Failures:")
        for c in failures:
            print(f"    [{c['name']}]")
            print(f"      input    : {c['input']}")
            print(f"      expected : {c['expected']}")
            print(f"      actual   : {c['actual']}")
            print()

    print("=" * 60)
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="PII scrubber regression benchmark")
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Write JSON report to FILE (e.g. benchmark_report.json)",
    )
    parser.add_argument(
        "--min-accuracy",
        type=float,
        default=None,
        metavar="PCT",
        help="Exit with code 1 if accuracy is below PCT (0-100)",
    )
    args = parser.parse_args()

    inputs, expected = load_fixtures()
    report = run_benchmark(inputs, expected)
    print_report(report)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w") as f:
            json.dump(report, f, indent=2)
        print(f"Report written to: {out_path}")

    if args.min_accuracy is not None:
        accuracy = report["summary"]["accuracy_pct"]
        if accuracy < args.min_accuracy:
            print(
                f"FAIL: accuracy {accuracy}% is below the required "
                f"{args.min_accuracy}% threshold.",
                file=sys.stderr,
            )
            sys.exit(1)
        else:
            print(
                f"PASS: accuracy {accuracy}% meets the {args.min_accuracy}% threshold."
            )


if __name__ == "__main__":
    main()
