# PII Scrubber Regression Benchmark Guide

This guide explains the comprehensive regression benchmark suite for the PII scrubber, added in GitHub issue #767.

## Overview

The benchmark tests the PII scrubber against a comprehensive fixture set covering:

- **True Positives** (6 fixtures): Real PII that should be scrubbed
- **True Negatives** (3 fixtures): Safe text that should NOT be modified
- **False Positives** (10 fixtures): Patterns that look like PII but aren't (version numbers, ports, colors, etc.)
- **False Negatives** (12 fixtures): Real PII in uncommon formats that highlight coverage gaps

**Total: 31 test fixtures** providing extensive regression coverage.

## Running the Benchmark

### Run All Tests

```bash
# From Soter/app/ai-service/ directory
pytest tests/test_pii_benchmark.py -v
pytest tests/test_pii_regression.py -v
```

### Run Just the Benchmark Metrics

```bash
pytest tests/test_pii_benchmark.py::TestPIIScrubberBenchmark -v
```

### Run Edge Case Tests

```bash
pytest tests/test_pii_regression.py::TestPIIRegressionEdgeCases -v
```

### Run Integration Tests

```bash
pytest tests/test_pii_regression.py::TestPIIRegressionIntegration -v
```

### Save Benchmark Results

The benchmark automatically saves results to `benchmark-results/pii-scrubber.json`:

```bash
pytest tests/test_pii_benchmark.py
# Results saved to: app/ai-service/benchmark-results/pii-scrubber.json
```

## Benchmark Metrics

### Precision (Target: >= 0.95)

**Definition**: True Positives / (True Positives + False Positives)

Measures the rate of false positives. A precision of 0.95 means 95% of detected PII is actually PII (5% are false positives).

**Why it matters**: High precision prevents over-scrubbing legitimate patterns that look like PII.

**Examples of false positives prevented**:
- Semantic versions: `v1.2.3.4`
- Port numbers: `localhost:3000`
- Hex colors: `#FF5733`
- Product SKUs: `SKU-123-45-6789`

### Recall (Target: >= 0.90)

**Definition**: True Positives / (True Positives + False Negatives)

Measures the rate of false negatives. A recall of 0.90 means 90% of real PII is caught (10% might be missed).

**Why it matters**: High recall ensures real PII is detected, protecting beneficiary privacy.

**Examples of PII to catch**:
- Standard emails: `john@example.com`
- Unusual TLDs: `user@example.museum`
- International phones: `+44 20 7946 0958`
- SSN with spaces: `123 45 6789`

### F1 Score (Target: >= 0.92)

**Definition**: 2 × (Precision × Recall) / (Precision + Recall)

The harmonic mean of precision and recall, measuring overall performance.

**Why it matters**: Ensures balanced tradeoff between:
- Not missing real PII (high recall)
- Not over-scrubbing safe patterns (high precision)

## Fixture Categories

### True Positives (PII Detection)

These fixtures verify that real PII is detected and correctly redacted:

```python
{
    "name": "email_standard",
    "text": "Contact: john.doe123@gmail.com",
    "expected_tokens": ["[EMAIL_ADDRESS]"],
    "min_count": 1,
}
```

**Coverage**:
- Standard and plus-addressed emails
- Nigerian phone numbers (+234 codes, local formats)
- National ID numbers (NIN, Voter ID)
- Street addresses
- Names with titles
- Dates in multiple formats

### True Negatives (Avoiding Over-Scrubbing)

These fixtures verify that safe text is NOT modified:

```python
{
    "name": "product_names",
    "text": "The Soter mobile app is built on the Stellar network.",
    "should_not_contain": ["[RECIPIENT_NAME]", "[LOCATION]"],
}
```

**Coverage**:
- Product names (Soter, Pulsefy, Stellar)
- Job titles (Manager, Coordinator)
- Technical terms (hash, block height)

### False Positive Guards (Pattern Preservation)

These fixtures ensure legitimate patterns that look like PII are preserved:

```python
{
    "name": "semantic_version",
    "text": "Version ^1.23.456 is available",
    "should_not_redact": "1.23.456",
}
```

**Coverage**:
- Semantic versions: `^1.23.456`
- Port numbers: `localhost:3000`
- Hex colors: `#FF5733`
- Product codes: `SKU-123-45-6789`
- Error codes: `404-123-4567`
- File paths with numbers
- Region codes: `TX-123-456`
- Mathematical constants: `3.14159`

### False Negative Fixtures (Coverage Gaps)

These fixtures highlight PII in uncommon formats that the current scrubber might not catch:

```python
{
    "name": "email_unusual_tld",
    "text": "Contact: researcher@example.museum",
    "should_contain": "[EMAIL_ADDRESS]",
    "original_text": "researcher@example.museum",
}
```

**Coverage**:
- Emails with unusual TLDs: `.museum`, `.co.uk`
- Emails with plus addressing: `user+tag@example.com`
- Emails in angle brackets: `<user@example.com>`
- International phone codes: `+44`, `+234` (various formats)
- Phone with dots: `234.567.8901`
- IDs with spaces: `123 45 6789`
- Names with accents: `José María García`
- Various date formats: `2024-08-15`, `15.08.2024`

## Regression Detection

The benchmark automatically detects regressions when:

1. **Precision drops below 0.95**: False positives increased
   - Risk: Over-scrubbing legitimate patterns
   - Action: Review pattern changes for over-matching

2. **Recall drops below 0.90**: False negatives increased
   - Risk: Missing real PII
   - Action: Expand pattern coverage

3. **F1 score drops below 0.92**: Overall performance degraded
   - Action: Review recent pattern changes

### Checking for Regressions

```bash
# Run benchmark and see detailed metrics
pytest tests/test_pii_benchmark.py::TestPIIScrubberBenchmark::test_benchmark_precision_meets_minimum -v
pytest tests/test_pii_benchmark.py::TestPIIScrubberBenchmark::test_benchmark_recall_meets_minimum -v
pytest tests/test_pii_benchmark.py::TestPIIScrubberBenchmark::test_benchmark_f1_meets_minimum -v
```

### Baseline Snapshot

A baseline snapshot is saved to `benchmark-results/baseline.json` for tracking metrics across commits:

```json
{
  "timestamp": "2026-08-24T...",
  "precision": 0.95,
  "recall": 0.90,
  "f1_score": 0.92,
  "total_fixtures": 31,
  "fixture_breakdown": {
    "true_positives": {"passed": 6, "failed": 0},
    "true_negatives": {"passed": 3, "failed": 0},
    "false_positives": {"passed": 10, "failed": 0},
    "false_negatives": {"passed": 12, "failed": 0}
  }
}
```

## File Locations

- **Benchmark implementation**: `tests/test_pii_benchmark.py`
- **Regression tests**: `tests/test_pii_regression.py`
- **Test fixtures**: `tests/pii_fixtures.py`
- **Baseline snapshot**: `tests/test_pii_benchmark_baseline.py`
- **Benchmark results** (generated): `benchmark-results/pii-scrubber.json`
- **Baseline snapshot** (generated): `benchmark-results/baseline.json`

## Adding New Fixtures

To add new PII patterns or test cases:

1. **For real PII to scrub**: Add to `PII_FIXTURES` in `pii_fixtures.py`
2. **For safe text to preserve**: Add to `SAFE_TEXT_FIXTURES` in `pii_fixtures.py`
3. **For false positives to prevent**: Add to `FALSE_POSITIVE_GUARDS` in `pii_fixtures.py`
4. **For coverage gaps to track**: Add to `FALSE_NEGATIVE_FIXTURES` in `pii_fixtures.py`

Example:

```python
PII_FIXTURES.append({
    "name": "new_pattern",
    "text": "Example text with PII",
    "expected_tokens": ["[TOKEN_TYPE]"],
    "min_count": 1,
})
```

Run the tests immediately to validate:

```bash
pytest tests/test_pii_regression.py -v
pytest tests/test_pii_benchmark.py -v
```

## Determinism Guarantee

The benchmark is **deterministic**: the same input always produces the same output and metrics.

- ✅ No random seeds or randomness
- ✅ Fixed fixture set
- ✅ Reproducible across local and CI runs
- ✅ Same results across git commits (unless patterns change)

The `test_benchmark_is_deterministic` test verifies this by running the benchmark twice and comparing results.

## CI/CD Integration

The benchmark runs automatically in CI:

```bash
# In GitHub Actions or other CI systems
pytest tests/test_pii_benchmark.py -v
pytest tests/test_pii_regression.py -v
```

**Failure conditions**:
- Any precision, recall, or F1 score falls below thresholds
- Any true positive, true negative, or false positive guard test fails
- Benchmark results cannot be serialized to JSON

## Performance

The benchmark completes in < 2 seconds on typical systems.

- 31 fixtures tested
- Each runs anonymize() once
- Minimal overhead for metrics calculation

## Debugging Failed Tests

### If a fixture fails:

```bash
# Run just that fixture
pytest tests/test_pii_regression.py::TestPIIRegressionComplete::test_pii_detection_coverage[email_standard] -v

# See detailed output
pytest -vv --tb=long
```

### To see scrubber output:

```python
from services.pii_scrubber import PIIScrubberService

service = PIIScrubberService()
result = service.anonymize("Dr. John Smith called at +234 801 234 5678")
print(result["anonymized_text"])
print(result["pii_summary"])
```

## References

- Main implementation: `services/pii_scrubber.py`
- Pattern definitions: Check `PIIScrubberService` class for regex patterns
- Issue #767: Expand PII Scrubber Regression Benchmarks
