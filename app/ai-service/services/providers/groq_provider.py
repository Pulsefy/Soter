"""
Groq provider — OpenAI-compatible LLM provider backed by Groq Cloud.

Requires ``GROQ_API_KEY`` to be set in the environment or ``.env`` file.
"""

from __future__ import annotations

import logging

from config import settings
from services.providers.base import LLMProvider

logger = logging.getLogger(__name__)


class GroqProvider(LLMProvider):
    """LLM provider backed by the Groq Cloud API (OpenAI-compatible)."""

    def __init__(self, api_key: str | None = None) -> None:
        self._key = api_key if api_key is not None else settings.groq_api_key

    # ------------------------------------------------------------------
    # LLMProvider contract
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return "groq"

    @property
    def _base_url(self) -> str:
        return "https://api.groq.com/openai/v1/chat/completions"

    @property
    def _api_key(self) -> str | None:
        return self._key
