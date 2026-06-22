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
    "pytesseract", "cv2",
    "PIL", "PIL.Image",
    "prometheus_client",
    "celery", "celery.result",
    "redis",
    "spacy", "spacy.language", "spacy.tokens", "spacy.tokens.doc",
    "openai", "openai.types", "openai.types.chat",
    "groq", "anthropic",
    "numpy",
]

import importlib.util

for _mod in _PKG_STUBS:
    root = _mod.split('.')[0]
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

# Patch metrics.check_system_resources so the monitor_requests middleware
# doesn't crash when torch (vram) is a MagicMock.
import metrics
metrics.check_system_resources = lambda **kwargs: True
