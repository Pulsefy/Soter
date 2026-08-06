"""v1 provider health endpoint.

Issue #770 — Add Provider Health Registry and Degradation Status

Exposes provider health without leaking sensitive details (no API keys,
no internal error messages).
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.provider_health import (
    ProviderHealthRegistry,
    ProviderStatus,
    provider_health_registry,
)
from services.circuit_breaker import CircuitBreaker
from services.providers import ProviderRegistry
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class ProviderHealthItem(BaseModel):
    name: str
    status: str = Field(..., description="One of: healthy, degraded, down")
    circuit_state: str = Field(
        ..., description="Circuit breaker state: CLOSED, OPEN, HALF_OPEN"
    )


class ProviderHealthResponse(BaseModel):
    overall: str = Field(..., description="Aggregate status: healthy, degraded, down")
    providers: List[ProviderHealthItem]
    degraded_count: int
    down_count: int


class ProviderHealthDetailResponse(BaseModel):
    overall: str
    providers: List[Dict[str, Any]]
    degraded_count: int
    down_count: int


def _get_circuit_breakers() -> Dict[str, CircuitBreaker]:
    try:
        import main as _main
        service = getattr(_main, "humanitarian_verification_service", None)
        if service is not None:
            return getattr(service, "breakers", {})
    except Exception as exc:
        logger.debug("Could not resolve circuit breakers: %s", exc)
    return {}


def _get_provider_names() -> List[str]:
    registry = ProviderRegistry()
    names = set()
    names.update(registry.available_llm_providers())
    names.update(registry.available_ocr_providers())
    return sorted(names)


@router.get("/ai/health/providers", response_model=ProviderHealthResponse)
async def get_provider_health():
    breakers = _get_circuit_breakers()
    provider_names = _get_provider_names()

    for name in provider_names:
        if name not in breakers:
            breakers[name] = CircuitBreaker(
                name=name,
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            )

    records = [
        provider_health_registry.get_health(name, breakers.get(name))
        for name in provider_names
    ]

    items = [
        ProviderHealthItem(
            name=r.name,
            status=r.status.value,
            circuit_state=r.circuit_state,
        )
        for r in records
    ]

    degraded = sum(1 for r in records if r.status == ProviderStatus.DEGRADED)
    down = sum(1 for r in records if r.status == ProviderStatus.DOWN)

    overall = ProviderStatus.HEALTHY.value
    if down > 0:
        overall = ProviderStatus.DEGRADED.value if any(
            r.status == ProviderStatus.HEALTHY for r in records
        ) else ProviderStatus.DOWN.value
    elif degraded > 0:
        overall = ProviderStatus.DEGRADED.value

    return ProviderHealthResponse(
        overall=overall,
        providers=items,
        degraded_count=degraded,
        down_count=down,
    )


@router.get("/ai/health/providers/detail", response_model=ProviderHealthDetailResponse)
async def get_provider_health_detail():
    breakers = _get_circuit_breakers()
    provider_names = _get_provider_names()

    for name in provider_names:
        if name not in breakers:
            breakers[name] = CircuitBreaker(
                name=name,
                failure_threshold=settings.circuit_breaker_failure_threshold,
                recovery_timeout=settings.circuit_breaker_recovery_timeout_seconds,
            )

    records = [
        provider_health_registry.get_health(name, breakers.get(name))
        for name in provider_names
    ]

    degraded = sum(1 for r in records if r.status == ProviderStatus.DEGRADED)
    down = sum(1 for r in records if r.status == ProviderStatus.DOWN)

    overall = ProviderStatus.HEALTHY.value
    if down > 0:
        overall = ProviderStatus.DEGRADED.value if any(
            r.status == ProviderStatus.HEALTHY for r in records
        ) else ProviderStatus.DOWN.value
    elif degraded > 0:
        overall = ProviderStatus.DEGRADED.value

    return ProviderHealthDetailResponse(
        overall=overall,
        providers=[r.to_dict(public=False) for r in records],
        degraded_count=degraded,
        down_count=down,
    )