import os
import json
import argparse
import difflib
import random
from typing import List
from regression_harness.models import EvaluationSample, BoundingBox
from regression_harness.evaluator import OCREvaluator


def load_samples(ground_truth_path: str) -> List[EvaluationSample]:
    with open(ground_truth_path, "r") as f:
        data = json.load(f)

    samples = []
    for s in data.get("samples", []):
        bboxes = {
            k: BoundingBox.from_dict(v) for k, v in s.get("expected_bboxes", {}).items()
        }
        samples.append(
            EvaluationSample(
                id=s["id"],
                image_path=s["image_path"],
                expected_fields=s["expected_fields"],
                expected_bboxes=bboxes,
                metadata=s.get("metadata", {}),
            )
        )
    return samples


def print_summary(report):
    print("\n" + "=" * 50)
    print(" OCR REGRESSION HARNESS SUMMARY")
    print("=" * 50)
    print(f"Total Samples:    {report.total_samples}")
    print(f"Passed:           {report.passed_samples}")
    print(f"Failed:           {report.failed_samples}")
    print(f"Accuracy:         {report.accuracy_percentage:.2f}%")
    print("-" * 50)
    print("Error breakdown:")
    for err, count in report.error_counts.items():
        if count > 0:
            print(f"  {err:20}: {count}")
    print("=" * 50 + "\n")

    if report.failed_samples > 0:
        print("FAILED SAMPLES DETAILS:")
        for res in report.sample_results:
            if not res.passed:
                print(f"\n[!] Sample ID: {res.sample_id}")
                for eval in res.field_evaluations:
                    if not eval.is_match:
                        print(
                            f"    - {eval.field_name}: Expected '{eval.expected_value}', Got '{eval.actual_value}' (Error: {eval.error_type})"
                        )
        print("\n" + "=" * 50)


def _verdict_for_sample(res) -> str:
    """Derive a coarse pass/review/reject verdict for a sample result."""
    if res.passed:
        return "pass"
    total = len(res.field_evaluations) or 1
    mismatches = sum(1 for e in res.field_evaluations if not e.is_match)
    ratio = mismatches / total
    if ratio <= 0.25:
        return "review"
    return "reject"


def _select_subset(samples: List[EvaluationSample], limit: int, seed: int) -> List[EvaluationSample]:
    if limit <= 0 or limit >= len(samples):
        return list(samples)
    rng = random.Random(seed)
    return rng.sample(samples, limit)


def run_dry_run(args, base_dir: str) -> int:
    gt_path = os.path.join(base_dir, args.dataset)
    if not os.path.exists(gt_path):
        print(f"Error: Dataset not found at {gt_path}")
        return 2

    samples = load_samples(gt_path)
    subset = _select_subset(samples, args.limit, args.seed)
    dataset_dir = os.path.dirname(gt_path)

    print(f"Dry-run: evaluating {len(subset)} representative sample(s)...")
    print(f"  Active prompt: {args.active_prompt}")
    print(f"  Draft prompt:  {args.draft_prompt}")

    active_evaluator = OCREvaluator(
        tolerance_threshold=args.threshold, prompt_version=args.active_prompt
    )
    draft_evaluator = OCREvaluator(
        tolerance_threshold=args.threshold, prompt_version=args.draft_prompt
    )

    active_report = active_evaluator.run_suite(subset, dataset_dir)
    draft_report = draft_evaluator.run_suite(subset, dataset_dir)

    active_by_id = {r.sample_id: r for r in active_report.sample_results}
    draft_by_id = {r.sample_id: r for r in draft_report.sample_results}

    verdict_changes = []
    score_drifts = []
    for sample in subset:
        sid = sample.id
        a_res = active_by_id.get(sid)
        d_res = draft_by_id.get(sid)
        if a_res is None or d_res is None:
            continue
        a_verdict = _verdict_for_sample(a_res)
        d_verdict = _verdict_for_sample(d_res)
        if a_verdict != d_verdict:
            verdict_changes.append((sid, a_verdict, d_verdict, a_res, d_res))
        else:
            score_drifts.append((sid, a_verdict, d_verdict))

    print("\n" + "=" * 50)
    print(" DRY-RUN PROMPT DIFF")
    print("=" * 50)
    print(f"Samples compared:      {len(subset)}")
    print(f"Verdict changes:       {len(verdict_changes)}")
    print(f"Unchanged verdicts:    {len(score_drifts)}")
    print("-" * 50)

    if verdict_changes:
        print("VERDICT CHANGES (highlighted):")
        for sid, a_verdict, d_verdict, a_res, d_res in verdict_changes:
            print(f"\n[!] Sample ID: {sid}")
            print(f"    Verdict: {a_verdict} -> {d_verdict}")
            a_fields = {e.field_name: e for e in a_res.field_evaluations}
            for d_eval in d_res.field_evaluations:
                a_eval = a_fields.get(d_eval.field_name)
                if a_eval is None:
                    continue
                if a_eval.actual_value != d_eval.actual_value:
                    print(
                        f"    - {d_eval.field_name}: "
                        f"'{a_eval.actual_value}' -> '{d_eval.actual_value}'"
                    )
    else:
        print("No verdict changes detected between active and draft prompts.")

    print("=" * 50 + "\n")

    if args.output:
        payload = {
            "active_prompt": args.active_prompt,
            "draft_prompt": args.draft_prompt,
            "samples_compared": len(subset),
            "verdict_changes": [
                {
                    "sample_id": sid,
                    "active_verdict": a_verdict,
                    "draft_verdict": d_verdict,
                }
                for sid, a_verdict, d_verdict, _, _ in verdict_changes
            ],
        }
        with open(args.output, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"Dry-run report saved to {args.output}")

    return 1 if verdict_changes else 0


def main():
    parser = argparse.ArgumentParser(description="OCR Regression Harness")
    parser.add_argument(
        "--dataset",
        default="regression_harness/dataset/ground_truth.json",
        help="Path to ground truth JSON",
    )
    parser.add_argument("--output", help="Path to save JSON report")
    parser.add_argument(
        "--threshold", type=float, default=0.8, help="Confidence threshold"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compare a draft prompt against the active prompt on a small subset",
    )
    parser.add_argument(
        "--draft-prompt",
        default="draft",
        help="Draft (not-yet-active) prompt version to evaluate in dry-run mode",
    )
    parser.add_argument(
        "--active-prompt",
        default="active",
        help="Currently-active prompt version to diff against in dry-run mode",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of representative samples to use in dry-run mode",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Random seed for deterministic subset selection in dry-run mode",
    )

    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Adjust base_dir if it's currently inside regression_harness
    if base_dir.endswith("regression_harness"):
        base_dir = os.path.dirname(base_dir)
        # We want base_dir to be app/ai-service

    if args.dry_run:
        exit(run_dry_run(args, base_dir))

    gt_path = os.path.join(base_dir, args.dataset)
    if not os.path.exists(gt_path):
        print(f"Error: Dataset not found at {gt_path}")
        return

    samples = load_samples(gt_path)
    evaluator = OCREvaluator(tolerance_threshold=args.threshold)

    print(f"Running evaluation on {len(samples)} samples...")
    report = evaluator.run_suite(samples, os.path.dirname(gt_path))

    print_summary(report)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(report.to_dict(), f, indent=2)
        print(f"Report saved to {args.output}")

    if report.failed_samples > 0:
        exit(1)


if __name__ == "__main__":
    main()
