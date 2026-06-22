"""Deterministic test provider that returns fixture-driven results."""

# Prevent pytest from collecting this module as test code.
__test__ = False

import hashlib
import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

_FIXTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


class TestProvider:
    """Returns stable, fixture-driven results for staging/testnet environments.

    Selects a response deterministically by hashing the endpoint name together
    with the serialised request data, so repeated calls with the same input
    always produce the same output.

    No API keys are required; the provider reads responses from JSON fixture
    files stored under ``<project_root>/fixtures/``.
    """

    def __init__(self, fixtures_dir: str = _FIXTURES_DIR):
        self._fixtures_dir = fixtures_dir
        self._cache: Dict[str, Any] = {}

    def get_response(self, endpoint: str, request_data: Dict[str, Any]) -> Dict[str, Any]:
        fixture = self._load_fixtures(endpoint)
        key = self._deterministic_key(endpoint, request_data)
        idx = int(hashlib.sha256(key.encode()).hexdigest(), 16) % len(fixture)
        selected = fixture[idx]
        logger.info(
            "TestProvider returning fixture %d/%d for endpoint=%s",
            idx, len(fixture), endpoint,
        )
        return dict(selected)

    def _deterministic_key(self, endpoint: str, request_data: Dict[str, Any]) -> str:
        data_str = json.dumps(request_data, sort_keys=True, default=str)
        return f"{endpoint}:{data_str}"

    def _load_fixtures(self, endpoint: str) -> list:
        if endpoint in self._cache:
            return self._cache[endpoint]

        fixture_path = os.path.join(self._fixtures_dir, f"{endpoint}_responses.json")
        if not os.path.exists(fixture_path):
            raise RuntimeError(
                f"No fixtures found for endpoint '{endpoint}' at {fixture_path}. "
                f"Create {fixture_path} with a JSON array of response objects."
            )

        with open(fixture_path) as f:
            fixtures = json.load(f)

        if not isinstance(fixtures, list):
            fixtures = [fixtures]

        if not fixtures:
            raise RuntimeError(f"Fixture file {fixture_path} is empty")

        self._cache[endpoint] = fixtures
        return fixtures
