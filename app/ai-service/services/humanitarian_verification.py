"""Humanitarian claim verification service with model/provider fallbacks."""

import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from config import settings
from services.humanitarian_prompt import HumanitarianPromptEngine

logger = logging.getLogger(__name__)


class HumanitarianVerificationService:
    """Runs humanitarian verification against configured LLM providers."""

    def __init__(self):
        self.prompt_engine = HumanitarianPromptEngine()

    def verify_claim(
        self,
        aid_claim: str,
        supporting_evidence: Optional[List[str]] = None,
        context_factors: Optional[Dict[str, Any]] = None,
        provider_preference: str = "auto",
    ) -> Dict[str, Any]:
        evidence = supporting_evidence or []
        context = context_factors or {}

        primary_prompt = self.prompt_engine.build_primary_prompt(
            aid_claim=aid_claim,
            supporting_evidence=evidence,
            context_factors=context,
        )
        fallback_prompt = self.prompt_engine.build_fallback_prompt(
            aid_claim=aid_claim,
            supporting_evidence=evidence,
            context_factors=context,
        )

        providers = self._provider_attempt_order(provider_preference)
        if not providers:
            raise RuntimeError("No LLM providers configured for humanitarian verification")

        errors: List[str] = []

        for provider in providers:
            model = self._get_model_for_provider(provider)
            for prompt_variant, prompt in (("primary", primary_prompt), ("fallback", fallback_prompt)):
                try:
                    logger.info(
                        "Attempting humanitarian verification with provider=%s model=%s prompt=%s",
                        provider,
                        model,
                        prompt_variant,
                    )
                    raw_content = self._call_provider(
                        provider=provider,
                        model=model,
                        system_prompt=prompt["system"],
                        user_prompt=prompt["user"],
                    )
                    parsed = self._parse_json_response(raw_content)
                    return {
                        "provider": provider,
                        "model": model,
                        "prompt_variant": prompt_variant,
                        "verification": parsed,
                        "raw_response": raw_content,
                    }
                except Exception as exc:
                    err = f"provider={provider}, model={model}, prompt={prompt_variant}, error={exc}"
                    errors.append(err)
                    logger.warning("Humanitarian verification attempt failed: %s", err)

        raise RuntimeError("All humanitarian verification attempts failed: " + " | ".join(errors))

    def _provider_attempt_order(self, provider_preference: str) -> List[str]:
        available: List[str] = []
        if settings.openai_api_key:
            available.append("openai")
        if settings.groq_api_key:
            available.append("groq")

        preference = (provider_preference or "auto").lower()
        if preference in ("openai", "groq") and preference in available:
            return [preference] + [provider for provider in available if provider != preference]
        return available

    def _get_model_for_provider(self, provider: str) -> str:
        if provider == "openai":
            return settings.openai_model
        if provider == "groq":
            return settings.groq_model
        raise ValueError(f"Unsupported provider: {provider}")

    def _call_provider(self, provider: str, model: str, system_prompt: str, user_prompt: str) -> str:
        if provider == "openai":
            return self._call_openai(model, system_prompt, user_prompt)
        if provider == "groq":
            return self._call_groq(model, system_prompt, user_prompt)
        raise ValueError(f"Unsupported provider: {provider}")

    def _call_openai(self, model: str, system_prompt: str, user_prompt: str) -> str:
        if not settings.openai_api_key:
            raise RuntimeError("OpenAI API key is not configured")

        return self._call_chat_completion_api(
            base_url="https://api.openai.com/v1/chat/completions",
            api_key=settings.openai_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

    def _call_groq(self, model: str, system_prompt: str, user_prompt: str) -> str:
        if not settings.groq_api_key:
            raise RuntimeError("Groq API key is not configured")

        return self._call_chat_completion_api(
            base_url="https://api.groq.com/openai/v1/chat/completions",
            api_key=settings.groq_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

    def _call_chat_completion_api(
        self,
        base_url: str,
        api_key: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
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

        timeout = float(settings.llm_timeout_seconds)

        with httpx.Client(timeout=timeout) as client:
            response = client.post(base_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected LLM response format: {data}") from exc

        if not content:
            raise RuntimeError("LLM returned empty content")

        return str(content)

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        normalized = content.strip()

        if normalized.startswith("```"):
            normalized = normalized.strip("`")
            if normalized.startswith("json"):
                normalized = normalized[4:].strip()

        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise RuntimeError("LLM response must be a JSON object")
        return parsed
