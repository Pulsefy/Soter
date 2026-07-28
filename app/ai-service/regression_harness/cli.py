import os
import json
import argparse
from typing import List
from regression_harness.models import EvaluationSample, BoundingBox
from regression_harness.evaluator import OCREvaluator

def load_samples(ground_truth_path: str) -> List[EvaluationSample]:
    with open(ground_truth_path, 'r') as f:
        data = json.load(f)
    
    samples = []
    for s in data.get("samples", []):
        bboxes = {
            k: BoundingBox.from_dict(v) 
            for k, v in s.get("expected_bboxes", {}).items()
        }
        samples.append(EvaluationSample(
            id=s["id"],
            image_path=s["image_path"],
            expected_fields=s["expected_fields"],
            expected_bboxes=bboxes,
            metadata=s.get("metadata", {})
        ))
    return samples

def print_summary(report):
    print("\n" + "="*50)
    print(" OCR REGRESSION HARNESS SUMMARY")
    print("="*50)
    print(f"Total Samples:    {report.total_samples}")
    print(f"Passed:           {report.passed_samples}")
    print(f"Failed:           {report.failed_samples}")
    print(f"Accuracy:         {report.accuracy_percentage:.2f}%")
    print("-" * 50)
    print("Error breakdown:")
    for err, count in report.error_counts.items():
        if count > 0:
            print(f"  {err:20}: {count}")
    print("="*50 + "\n")

    if report.failed_samples > 0:
        print("FAILED SAMPLES DETAILS:")
        for res in report.sample_results:
            if not res.passed:
                print(f"\n[!] Sample ID: {res.sample_id}")
                for eval in res.field_evaluations:
                    if not eval.is_match:
                        print(f"    - {eval.field_name}: Expected '{eval.expected_value}', Got '{eval.actual_value}' (Error: {eval.error_type})")
        print("\n" + "="*50)

def main():
    parser = argparse.ArgumentParser(description="OCR Regression Harness")
    parser.add_argument("--dataset", default="regression_harness/dataset/ground_truth.json", help="Path to ground truth JSON")
    parser.add_argument("--output", help="Path to save JSON report")
    parser.add_argument("--threshold", type=float, default=0.8, help="Confidence threshold")
    
    args = parser.parse_args()
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Adjust base_dir if it's currently inside regression_harness
    if base_dir.endswith("regression_harness"):
        base_dir = os.path.dirname(base_dir)
        # We want base_dir to be app/ai-service

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
        with open(args.output, 'w') as f:
            json.dump(report.to_dict(), f, indent=2)
        print(f"Report saved to {args.output}")

    if report.failed_samples > 0:
        exit(1)

if __name__ == "__main__":
    main()
