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
