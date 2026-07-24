"""
Test / fixture LLM provider.

Returns deterministic, fixture-driven responses without external API calls.
Used when ``TEST_PROVIDER_MODE=true`` or when no real API keys are configured.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from services.providers.base import LLMProvider
from services.test_provider import TestProvider

logger = logging.getLogger(__name__)


class TestLLMProvider(LLMProvider):
    """LLM provider that returns fixture-driven results from ``TestProvider``.

    Does **not** require any API keys and always produces the same output
    for the same input — ideal for CI, staging, and deterministic testing.
    """

    def __init__(self) -> None:
        self._test = TestProvider()

    # ------------------------------------------------------------------
    # LLMProvider contract
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return "test"

    @property
    def _base_url(self) -> str:
        return ""  # not used

    @property
    def _api_key(self) -> Optional[str]:
        return None  # not required

    # ------------------------------------------------------------------
    # Override — does NOT use the HTTP helper
    # ------------------------------------------------------------------

    def call(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        _ = model, timeout  # unused in fixture mode
        response = self._test.get_response(
            endpoint="humanitarian",
            request_data={
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            },
        )
        return json.dumps(response, separators=(",", ":"), sort_keys=True)
