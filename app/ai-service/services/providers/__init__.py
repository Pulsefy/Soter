"""
Provider factory — assembles available LLM providers based on active configuration.

Usage::

    from services.providers import get_llm_providers
    providers = get_llm_providers(provider_preference="auto")
"""

from __future__ import annotations

from typing import List

from config import settings
from services.providers.base import LLMProvider
from services.providers.openai_provider import OpenAIProvider
from services.providers.groq_provider import GroqProvider
from services.providers.test_llm_provider import TestLLMProvider


def get_llm_providers(provider_preference: str = "auto") -> List[LLMProvider]:
    """Return available LLM providers ordered by preference.

    When ``provider_preference`` is ``"auto"`` (the default) the list
    respects the natural priority: test > openai > groq.  Passing an
    explicit provider name moves that provider to the front of the list
    (if available).

    Providers that lack their required API key are **excluded** from the
    returned list, so callers can safely iterate without checking keys
    themselves.
    """
    available: List[LLMProvider] = []

    # Test provider — always eligible when test_provider_mode is on
    if settings.test_provider_mode:
        available.append(TestLLMProvider())

    # OpenAI
    if settings.openai_api_key:
        available.append(OpenAIProvider())

    # Groq
    if settings.groq_api_key:
        available.append(GroqProvider())

    pref = (provider_preference or "auto").lower()

    if pref == "auto":
        return available

    # Promote the requested provider to the front
    ordered: List[LLMProvider] = []
    for p in available:
        if p.name == pref:
            ordered.insert(0, p)
        else:
            ordered.append(p)

    return ordered


__all__ = [
    "LLMProvider",
    "OpenAIProvider",
    "GroqProvider",
    "TestLLMProvider",
    "get_llm_providers",
]
