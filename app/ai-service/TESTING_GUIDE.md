"""
Quick Reference: Running Verification Metadata Tests
=====================================================

This guide explains how to run the comprehensive test suite for the contract-aware
verification metadata implementation.

## Prerequisites

```bash
cd app/ai-service
pip install -r requirements.txt  # Ensure pytest and dependencies are installed
```

## Running Tests

### Run All Metadata Tests
```bash
pytest tests/test_*metadata*.py -v
```

### Run Individual Test Suites

#### 1. Schema Validation Tests (18 tests)
```bash
pytest tests/test_metadata.py -v
```

Tests cover:
- Valid metadata creation
- Optional field handling
- Identifier validation (empty, whitespace)
- Timestamp validation (bounds checking)
- Auto-generated verification IDs
- Whitespace trimming
- Serialization

#### 2. Humanitarian Verification Metadata Tests (13 tests)
```bash
pytest tests/test_humanitarian_verification_metadata.py -v
```

Tests cover:
- Request/response schema structure
- Metadata field validation
- Metadata propagation through verification
- Backward compatibility
- Stable identifier verification
- Timestamp reasonableness

#### 3. Fraud Detection Metadata Tests (13 tests)
```bash
pytest tests/test_fraud_detection_metadata.py -v
```

Tests cover:
- Metadata field propagation
- Mixed metadata scenarios
- Batch-level processing
- Single-claim handling
- Multi-campaign tracking

#### 4. API Integration Tests (27 tests)
```bash
pytest tests/test_metadata_api_integration.py -v
```

Tests cover:
- Endpoint request/response handling
- Payload shape validation
- Metadata validation at API level
- Error handling
- Backward compatibility

## Running with Coverage

```bash
# Generate coverage report
pytest tests/test_*metadata*.py --cov=schemas --cov=services --cov=api -v

# HTML coverage report
pytest tests/test_*metadata*.py --cov=schemas --cov=services --cov=api --cov-report=html
# Open htmlcov/index.html in browser
```

## Running Specific Tests

```bash
# Run a specific test class
pytest tests/test_metadata.py::TestVerificationMetadata -v

# Run a specific test method
pytest tests/test_metadata.py::TestVerificationMetadata::test_valid_metadata_creation -v

# Run tests matching a pattern
pytest tests/test_*metadata*.py -k "validation" -v
```

## Test Execution Flow

```
pytest runs
  ├─ test_metadata.py (18 tests)
  │  ├─ Schema creation and validation
  │  ├─ Identifier validation
  │  ├─ Timestamp validation
  │  └─ Serialization tests
  │
  ├─ test_humanitarian_verification_metadata.py (13 tests)
  │  ├─ Request/response structure
  │  ├─ Metadata propagation
  │  ├─ Service integration
  │  └─ Backward compatibility
  │
  ├─ test_fraud_detection_metadata.py (13 tests)
  │  ├─ Metadata propagation in fraud detection
  │  ├─ Batch processing
  │  ├─ Campaign tracking
  │  └─ Result serialization
  │
  └─ test_metadata_api_integration.py (27 tests)
     ├─ Endpoint integration
     ├─ Payload validation
     ├─ Metadata handling
     └─ Error scenarios

Total: 71 tests
```

## Expected Test Results

All tests should pass with output similar to:

```
========================= 71 passed in 2.45s =========================
```

## Debugging Test Failures

If a test fails, use verbose output to see details:

```bash
pytest tests/test_metadata.py -vv  # Extra verbosity
pytest tests/test_metadata.py -s   # Show print statements
pytest tests/test_metadata.py -x   # Stop on first failure
```

## Integration with CI/CD

```bash
# Run tests in CI/CD pipeline
pytest tests/test_*metadata*.py --tb=short -q

# Generate JUnit XML for CI systems
pytest tests/test_*metadata*.py --junit-xml=test-results.xml
```

## Test Configuration

Tests use pytest fixtures and mocking:
- `pytest.fixture` - Reusable test components
- `unittest.mock.patch` - Mock external services
- `time` module - Timestamp testing
- `json` module - Serialization testing

## Common Issues

### ImportError: No module named 'pydantic'
```bash
pip install pydantic fastapi httpx scikit-learn numpy
```

### Test discovery issues
```bash
pytest --collect-only  # List all discovered tests
```

### Timeout in tests
```bash
pytest --timeout=10  # Set per-test timeout
```

## Performance Metrics

Expected execution time:
- All 71 tests: ~2-5 seconds
- Individual suite: <1 second each
- With coverage: ~10-15 seconds

## Next Steps After Tests Pass

1. **Integration Testing:** Run tests with real AI services
2. **Contract Testing:** Verify on-chain anchoring format
3. **Performance Testing:** Benchmark metadata propagation
4. **Load Testing:** Verify batch processing at scale

---
For more details, see VERIFICATION_METADATA_IMPLEMENTATION.md
"""
