"""
v1 metadata endpoint — reports active providers, model versions,
and capability flags for debugging and integration checks.

This endpoint intentionally excludes secrets and private credentials.
"""

import logging
import platform
from typing import Any, Dict

from fastapi import APIRouter
import pydantic

from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["metadata"])


def _build_metadata() -> Dict[str, Any]:
    """Build a safe metadata payload without exposing secrets."""
    provider = settings.get_active_provider()

    # Available models (only report configured provider's model)
    models: Dict[str, str] = {}
    if provider == "openai" and settings.openai_api_key:
        models["openai"] = settings.openai_model
    if provider == "groq" and settings.groq_api_key:
        models["groq"] = settings.groq_model
    if provider == "test":
        models["test"] = "test-fixture"

    return {
        "provider": {
            "active": provider,
            "configured": {
                "openai": bool(settings.openai_api_key),
                "groq": bool(settings.groq_api_key),
                "test": settings.test_provider_mode,
            },
        },
        "models": models,
        "capabilities": {
            "deterministic_mode": settings.ai_deterministic_mode,
            "test_provider_mode": settings.test_provider_mode,
        },
        "runtime": {
            "python_version": platform.python_version(),
            "pydantic_version": pydantic.__version__,
            "app_env": settings.app_env,
        },
        "_links": {
            "self": "/v1/ai/metadata",
            "health": "/health",
            "dependencies": "/health/dependencies",
        },
    }


@router.get(
    "/ai/metadata",
    summary="Model & Provider Metadata",
    description=(
        "Returns a safe metadata payload describing the active AI provider, "
        "configured model versions, and capability flags. Excludes all secrets "
        "and private credentials. Suitable for debugging and integration checks."
    ),
)
async def get_metadata():
    """
    Report active provider, model versions, and capability flags.

    Response fields:
    - **provider.active**: Currently active provider (openai, groq, test, or null).
    - **provider.configured**: Boolean flags for each configured provider.
    - **models**: Currently active model identifiers per provider.
    - **capabilities**: Feature flags (deterministic mode, test provider mode, etc.).
    - **runtime**: Python runtime info and application environment.
    - **_links**: Related diagnostic endpoints.
    """
    return _build_metadata()
