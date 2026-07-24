"""
OpenAI provider — the **reference implementation** for ``LLMProvider``.

Uses the OpenAI Chat Completions API.  Requires ``OPENAI_API_KEY``
to be set in the environment or ``.env`` file.
"""

from __future__ import annotations

import logging

from config import settings
from services.providers.base import LLMProvider

logger = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    """LLM provider backed by the OpenAI Chat Completions API.

    This is the canonical reference implementation.  Other chat-completion-
    compatible providers (e.g. Groq, Together, Anyscale) can follow the
    exact same pattern, changing only ``name``, ``_base_url``, and the
    API-key configuration.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self._key = api_key if api_key is not None else settings.openai_api_key

    # ------------------------------------------------------------------
    # LLMProvider contract
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return "openai"

    @property
    def _base_url(self) -> str:
        return "https://api.openai.com/v1/chat/completions"

    @property
    def _api_key(self) -> str | None:
        return self._key
