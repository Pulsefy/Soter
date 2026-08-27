# OCR Regression Harness

The OCR Regression Harness is a tool designed to prevent extraction accuracy regressions by running OCR against a "golden dataset" of representative documents and comparing the results to ground truth values.

## Directory Structure

- `regression_harness/`: Main package for the harness.
  - `cli.py`: Command line interface.
  - `evaluator.py`: Evaluation logic.
  - `models.py`: Data models for samples and reports.
  - `dataset/`: Contains the golden dataset.
    - `documents/`: Folder for raw images (PNG, JPG).
    - `ground_truth.json`: The source of truth for expected values.

## How to Run Locally

1. Ensure you are in the `app/ai-service` directory.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the harness:
   ```bash
   export PYTHONPATH=.
   python regression_harness/cli.py
   ```
   *Note: On Windows, use `set PYTHONPATH=.`*

### CLI Options

- `--dataset`: Path to ground truth JSON (default: `regression_harness/dataset/ground_truth.json`).
- `--output`: Path to save a machine-readable JSON report.
- `--threshold`: Minimum confidence threshold for fields (default: 0.8).

## Adding New Golden Samples

1. **Add the Image**: Place the document image in `regression_harness/dataset/documents/`.
2. **Update Ground Truth**: Edit `regression_harness/dataset/ground_truth.json` to add a new entry in the `samples` array.

```json
{
  "id": "item_001",
  "image_path": "documents/item_001.png",
  "expected_fields": {
    "name": "EXACT EXPECTED NAME",
    "id_number": "EXPECTED ID"
  },
  "metadata": {
    "document_type": "passport",
    "language": "en"
  }
}
```

## Error Classification

Failures are categorized into one of these groups:
- **Missing field**: A required field was not detected by the OCR service.
- **Incorrect value**: The field was detected but the value didn't match the ground truth.
- **Unexpected field**: OCR extracted a field that wasn't defined in the ground truth.
- **Low confidence**: The field matched but OCR engine's confidence was below the threshold.
- **Image not found**: The specified image path in ground truth is invalid.

## CI Integration

The harness runs automatically on every PR that touches OCR logic or the regression harness itself via `.github/workflows/ocr-regression.yml`. If the accuracy falls below 100% (or if any sample fails), the CI job will fail.

---

# Golden-Set Accuracy Harness (Humanitarian Verification)

The Golden-Set Accuracy Harness measures the accuracy of the humanitarian verification service against a labelled set of "golden" claim cases. Each case contains a claim, supporting evidence, and context factors, together with a human-annotated expected verdict label: `approve`, `reject`, or `ambiguous`.

The harness always runs against the deterministic fixture provider (`TestProvider`), never a real LLM, so every run is fully offline, fast, and reproducible.

## Files

- `regression_harness/fixtures/golden_fixtures.json`: The labelled golden set (15 cases, 5 per category).
- `regression_harness/deterministic_provider.py`: Wraps the existing `FixtureProvider`/`TestProvider` into the verification flow (prompt build + verdict parse + label mapping).
- `regression_harness/run_accuracy_harness.py`: Loads the fixtures, runs the suite, computes per-class precision/recall/F1 and overall accuracy, compares against the baseline, and reports per-case PASS/FAIL.
- `regression_harness/baseline_metrics.json`: The committed reference metrics that the harness compares against.

## How to Run

From the `app/ai-service` directory:

```bash
python regression_harness/run_accuracy_harness.py
```

The command prints a summary table (overall accuracy, per-class precision/recall/F1, and a per-case PASS/FAIL list). Exit codes:

- `0`: Metrics match the baseline (or no baseline exists yet).
- `1`: Metrics drifted from the baseline (regression detected).
- `2`: Fixtures or arguments are invalid (e.g., a label category is missing).

Optional flags:

- `--fixtures <path>`: Path to the golden-set JSON file (default: `fixtures/golden_fixtures.json`).
- `--baseline <path>`: Path to the baseline JSON file (default: `baseline_metrics.json`).
- `--output <path>`: Write a machine-readable JSON report (metrics + per-case outcomes).
- `--update-baseline`: Overwrite the baseline with the metrics from the current run.

## Adding a New Labelled Case

1. Edit `regression_harness/fixtures/golden_fixtures.json`.
2. Append an object with:
   - `id`: A unique case identifier.
   - `input`: An object with `aid_claim` (string), `supporting_evidence` (array of strings), and `context_factors` (object). `supporting_evidence` and `context_factors` may be omitted.
   - `expected`: One of `approve`, `reject`, `ambiguous` (the human-judged ground truth).

Example:

```json
{
  "id": "approve_006",
  "input": {
    "aid_claim": "Two thousand blankets were delivered to the transit site.",
    "supporting_evidence": ["Delivery manifest signed by site coordinator"],
    "context_factors": {"displacement_level": "high"}
  },
  "expected": "approve"
}
```

3. Ensure every one of the three categories still has at least one case; the harness rejects a golden set that is missing a category. Keep the labels balanced if possible so per-class metrics stay meaningful.

## Baseline Metrics

The committed `baseline_metrics.json` is the reference for detecting drift. On every run the harness compares the current metrics against the baseline for `accuracy` and for per-class `precision`, `recall`, and `f1`. Any difference beyond the tolerance prints the affected metrics and makes the run exit with code `1`.

- If the baseline file is missing, the harness still runs and exits `0` with a warning.
- To (re)generate the baseline after intentionally changing the golden set or the verification logic, run:

```bash
python regression_harness/run_accuracy_harness.py --update-baseline
```

Then commit the updated `baseline_metrics.json` together with the change that caused the metrics to move.
