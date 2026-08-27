# PII Scrubber Benchmark - Quick Reference

## Run All Tests
```bash
pytest tests/test_pii_benchmark.py tests/test_pii_regression.py -v
```

## Key Commands

| Command | Purpose |
|---------|---------|
| `pytest tests/test_pii_benchmark.py -v` | Run all benchmark tests |
| `pytest tests/test_pii_regression.py -v` | Run all regression tests |
| `pytest tests/test_pii_regression.py::TestPIIRegressionEdgeCases -v` | Run edge case tests |
| `pytest tests/test_pii_regression.py::TestPIIRegressionIntegration -v` | Run integration tests |

## Benchmark Metrics (Targets)

| Metric | Target | Purpose |
|--------|--------|---------|
| **Precision** | >= 0.95 | Prevent false positives (over-scrubbing) |
| **Recall** | >= 0.90 | Catch real PII (90%+ coverage) |
| **F1 Score** | >= 0.92 | Balanced performance |

## Test Coverage Summary

```
Total: 31 Fixtures

✓ True Positives (6):      PII that should be scrubbed
  • Email, Phone, ID, Location, Names, Dates

✓ True Negatives (3):      Safe text that should NOT be modified
  • Product names, Job titles, Technical terms

✓ False Positives (10):    Patterns that look like PII but aren't
  • Versions, Ports, Colors, SKUs, Error codes, Paths, etc.

✓ False Negatives (12):    Real PII in uncommon formats (coverage gaps)
  • Unusual TLDs, International phones, Unicode names, ISO dates, etc.
```

## Output Files

| File | Location | Purpose |
|------|----------|---------|
| Benchmark results | `benchmark-results/pii-scrubber.json` | Latest metrics & breakdown |
| Baseline snapshot | `benchmark-results/baseline.json` | For regression detection |

## Fixture Files

| File | Location | Purpose |
|------|----------|---------|
| Test fixtures | `tests/pii_fixtures.py` | All test data (31 fixtures) |
| Benchmark code | `tests/test_pii_benchmark.py` | Metric calculation & tests |
| Regression tests | `tests/test_pii_regression.py` | Comprehensive test suite |
| Baseline data | `tests/test_pii_benchmark_baseline.py` | Thresholds & snapshots |

## Debug a Failed Test

```bash
# Run with full output
pytest tests/test_pii_regression.py -vv --tb=long

# Run specific fixture
pytest tests/test_pii_regression.py::TestPIIRegressionComplete::test_pii_detection_coverage[email_standard] -vv

# Check current metrics
pytest tests/test_pii_benchmark.py::TestPIIScrubberBenchmark::test_benchmark_precision_meets_minimum -v
```

## Add a New Test Fixture

1. Edit `tests/pii_fixtures.py`
2. Add to appropriate list:
   - `PII_FIXTURES` - Real PII to scrub
   - `SAFE_TEXT_FIXTURES` - Safe text to preserve
   - `FALSE_POSITIVE_GUARDS` - Patterns to NOT scrub
   - `FALSE_NEGATIVE_FIXTURES` - Coverage gaps

3. Example for `PII_FIXTURES`:
```python
{
    "name": "unique_name",
    "text": "Text with PII to detect",
    "expected_tokens": ["[TOKEN_TYPE]"],
    "min_count": 1,
}
```

4. Run tests:
```bash
pytest tests/test_pii_regression.py -v
```

## Regression Detection

If any metric drops below minimum:

| Failure | Root Cause | Fix |
|---------|-----------|-----|
| Precision < 0.95 | Over-scrubbing safe patterns | Review pattern changes, tighten regex |
| Recall < 0.90 | Missing real PII | Expand pattern coverage |
| F1 < 0.92 | Overall performance degraded | Investigate recent changes |

## Expected Results

All tests should **PASS**:

```
TestPIIScrubberBenchmark
  ✓ test_benchmark_precision_meets_minimum
  ✓ test_benchmark_recall_meets_minimum
  ✓ test_benchmark_f1_meets_minimum
  ✓ test_true_positives_fully_detected (6 passed)
  ✓ test_true_negatives_fully_preserved (3 passed)
  ✓ test_false_positive_guards_all_pass (10 passed)
  ✓ test_benchmark_is_deterministic
  ✓ test_benchmark_results_saved_to_file
  ✓ test_benchmark_has_all_required_fields

TestPIIRegressionComplete
  ✓ test_pii_detection_coverage (6 parametrized)
  ✓ test_safe_text_is_not_redacted (3 parametrized)
  ✓ test_false_positive_guards (10 parametrized)
  ✓ test_false_negative_coverage (12 parametrized, may skip)

TestPIIRegressionEdgeCases
  ✓ test_empty_string
  ✓ test_whitespace_only
  ✓ test_no_pii
  ... (10 more edge case tests)

TestPIIRegressionIntegration
  ✓ test_real_world_assistance_report
  ✓ test_context_preservation_around_pii
  ✓ test_multiple_emails_with_context
```

## PII Pattern Categories

Current coverage in `services/pii_scrubber.py`:

| Category | Token Name | Regex Patterns | SpaCy Patterns |
|----------|-----------|-----------------|-----------------|
| Email | `[EMAIL_ADDRESS]` | 1 | - |
| Phone | `[PHONE_NUMBER]` | 3 | - |
| ID | `[ID_NUMBER]` | 2 | - |
| Names | `[RECIPIENT_NAME]` | 2 | 2 |
| Locations | `[LOCATION]` | 2 | 1 |
| Dates | `[EVENT_DATE]` | 4 | 3 |

## Performance

- **Time**: ~2 seconds (31 fixtures)
- **Memory**: ~200 MB
- **Deterministic**: Yes (same input = same output)
- **CI-friendly**: Yes (no random, no external deps)

## Links

- 📖 [Full Guide](./PII_SCRUBBER_BENCHMARK_GUIDE.md)
- 🏗️ [Implementation Details](./REGRESSION_BENCHMARK_IMPLEMENTATION.md)
- 💻 [Benchmark Code](./tests/test_pii_benchmark.py)
- 📋 [Test Fixtures](./tests/pii_fixtures.py)
- 🔧 [PII Scrubber Service](./services/pii_scrubber.py)

## Issue Reference

**GitHub Issue #767**: Expand PII Scrubber Regression Benchmarks

✅ Step 1: Understand existing PII scrubber
✅ Step 2: Create comprehensive fixture set (31 fixtures)
✅ Step 3: Create benchmark file with metrics
✅ Step 4: Add regression tests with thresholds
✅ Step 5: Make results easy to compare (JSON + .gitignore)
