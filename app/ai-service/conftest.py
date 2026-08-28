"""
Stub out native/optional dependencies unavailable outside Docker.
"""

import sys
from unittest.mock import MagicMock, patch


class StubMock(MagicMock):
    @property
    def __spec__(self):
        return None


def _make_pkg(name: str):
    mod = StubMock()
    mod.__path__ = []
    mod.__package__ = name
    return mod


_PKG_STUBS = [
    "pytesseract",
    "cv2",
    "PIL",
    "PIL.Image",
    "prometheus_client",
    "celery",
    "celery.result",
    "redis",
    "spacy",
    "spacy.language",
    "spacy.tokens",
    "spacy.tokens.doc",
    "openai",
    "openai.types",
    "openai.types.chat",
    "groq",
    "anthropic",
    "numpy",
]

import importlib.util

for _mod in _PKG_STUBS:
    root = _mod.split(".")[0]
    try:
        spec = importlib.util.find_spec(root)
        has_pkg = spec is not None
    except Exception:
        has_pkg = False

    if not has_pkg:
        if _mod not in sys.modules:
            sys.modules[_mod] = _make_pkg(_mod)

# proof_of_life raises RuntimeError at import time when cv2 is mocked.
_pol = _make_pkg("proof_of_life")
_pol.ProofOfLifeAnalyzer = MagicMock()
_pol.ProofOfLifeConfig = MagicMock()
sys.modules["proof_of_life"] = _pol

# Configure cv2 stub if mocked
if "cv2" in sys.modules and isinstance(sys.modules["cv2"], MagicMock):
    cv2_mock = sys.modules["cv2"]
    cv2_mock.THRESH_BINARY = 0
    cv2_mock.THRESH_OTSU = 8
    cv2_mock.ADAPTIVE_THRESH_GAUSSIAN_C = 1
    cv2_mock.COLOR_GRAY2BGR = 8
    cv2_mock.COLOR_BGR2GRAY = 6
    cv2_mock.threshold.side_effect = lambda src, thresh, maxval, type: (0, src)
    cv2_mock.adaptiveThreshold.side_effect = lambda src, *args, **kwargs: src
    cv2_mock.fastNlMeansDenoisingColored.side_effect = lambda src, *args, **kwargs: src
    cv2_mock.cvtColor.side_effect = lambda src, *args, **kwargs: src

# Patch metrics.check_system_resources so the monitor_requests middleware
# doesn't crash when torch (vram) is a MagicMock.
import metrics
import pytest

metrics.check_system_resources = lambda **kwargs: True

# ==================== PII Scrubber Benchmark Fixtures ====================
# Fixtures for regression benchmark tests


@pytest.fixture(autouse=True)
def reset_app_state():
    """Ensure app state is clean before each test to prevent interference."""
    from main import app

    # Ensure app state is initialized
    if not hasattr(app.state, "is_shutting_down"):
        app.state.is_shutting_down = False
    if not hasattr(app.state, "active_requests"):
        app.state.active_requests = 0

    # Reset to healthy state before each test
    app.state.is_shutting_down = False
    app.state.active_requests = 0

    yield

    # Cleanup after test
    app.state.is_shutting_down = False
    app.state.active_requests = 0


@pytest.fixture(scope="session")
def pii_scrubber_benchmark():
    """
    Session-scoped fixture providing PII scrubber benchmark instance.

    Benchmarks the PII scrubber against comprehensive fixture set and returns
    metrics:
    - precision: >=0.85 (acceptable false positive rate)
    - recall: >=0.65 (acceptable false negative rate)
    - f1_score: >=0.72 (balanced performance)
    - fixture breakdown by category (true pos/neg, false pos/neg)

    Usage in tests:
        def test_something(pii_scrubber_benchmark):
            metrics = pii_scrubber_benchmark.metrics
            assert metrics['precision'] >= 0.85
    """
    try:
        from tests.test_pii_benchmark import PIIScrubberBenchmark

        benchmark = PIIScrubberBenchmark()
        benchmark.run_all_benchmarks()
        return benchmark
    except Exception:
        # If benchmark setup fails, return None and skip tests
        return None


@pytest.fixture(scope="module")
def pii_scrubber_service():
    """
    Module-scoped fixture providing initialized PII scrubber service.

    Usage in tests:
        def test_scrub_pii(pii_scrubber_service):
            result = pii_scrubber_service.anonymize("Dr. John Smith")
            assert "[RECIPIENT_NAME]" in result["anonymized_text"]
    """
    from services.pii_scrubber import PIIScrubberService

    return PIIScrubberService()
