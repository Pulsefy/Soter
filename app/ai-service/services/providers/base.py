"""
Abstract base class for LLM providers.

Defines the contract that all LLM providers must implement:
- ``name``: unique provider identifier (e.g. "openai", "groq")
- ``call(model, system_prompt, user_prompt, timeout) -> str``: invoke the model
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Optional

import httpx

from config import settings
from exceptions import AIServiceError

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    """Abstract contract for an LLM provider.

    Subclasses need only supply a ``name``, ``_base_url``, and ``_api_key``
    (or implement ``call`` directly for non-HTTP providers).
    """

    # ------------------------------------------------------------------
    # Subclass contract
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique short identifier, e.g. ``"openai"``, ``"groq"``."""

    @property
    @abstractmethod
    def _base_url(self) -> str:
        """Chat-completions endpoint URL."""

    @property
    @abstractmethod
    def _api_key(self) -> Optional[str]:
        """API key for authentication, or ``None`` if not available."""

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def call(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        """Invoke the provider and return the raw text response.

        The default implementation uses an OpenAI-compatible chat-completions
        API.  Providers with a different protocol should override this method.
        """
        api_key = self._api_key
        if not api_key:
            raise RuntimeError(f"{self.name} API key is not configured")

        return self._call_chat_completion_api(
            base_url=self._base_url,
            api_key=api_key,
            provider_name=self.name,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    # ------------------------------------------------------------------
    # Shared helpers for OpenAI-compatible providers
    # ------------------------------------------------------------------

    @staticmethod
    def _call_chat_completion_api(
        *,
        base_url: str,
        api_key: str,
        provider_name: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        """Make an OpenAI-compatible chat-completions request.

        Centralises HTTP boilerplate, deterministic-mode short-circuit,
        timeout handling, and error wrapping so concrete providers stay
        focused on configuration.
        """
        if settings.ai_deterministic_mode:
            logger.info(
                "Deterministic AI mode enabled: returning stable response for %s",
                provider_name,
            )
            return LLMProvider._get_deterministic_response()

        payload = {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        req_timeout = (
            timeout if timeout is not None else float(settings.llm_timeout_seconds)
        )

        try:
            with httpx.Client(timeout=req_timeout) as client:
                response = client.post(base_url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            logger.error(
                "LLM provider %s request timed out after %s seconds",
                provider_name,
                req_timeout,
            )
            raise AIServiceError(
                message=f"LLM request timed out after {req_timeout}s",
                code="AI_TIMEOUT",
                details={
                    "provider": provider_name,
                    "timeout_seconds": req_timeout,
                },
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error(
                "LLM provider %s returned status %s: %s",
                provider_name,
                exc.response.status_code,
                exc.response.text,
            )
            raise AIServiceError(
                message=f"LLM request failed with status {exc.response.status_code}",
                code="AI_PROVIDER_ERROR",
                details={
                    "provider": provider_name,
                    "status_code": exc.response.status_code,
                },
            ) from exc
        except Exception as exc:
            logger.error(
                "LLM provider %s connection or unexpected error: %s",
                provider_name,
                str(exc),
            )
            raise AIServiceError(
                message=f"LLM connection error: {str(exc)}",
                code="AI_CONNECTION_ERROR",
                details={"provider": provider_name},
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                f"Unexpected LLM response format from {provider_name}: {data}"
            ) from exc

        if not content:
            raise RuntimeError(f"{provider_name} returned empty content")

        return str(content)

    @staticmethod
    def _get_deterministic_response() -> str:
        """Return a stable JSON response for deterministic/test mode."""
        stable = {
            "verdict": "credible",
            "confidence": 0.74,
            "summary": "Deterministic verification output for testing",
        }
        return json.dumps(stable, separators=(",", ":"), sort_keys=True)
