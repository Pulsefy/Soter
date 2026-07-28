"""
Load-shedding for the AI service under pressure (Issue #621).

Rejects incoming work with HTTP 503 and a standardized error envelope when
system memory, the Celery queue, or configured LLM providers are overloaded.
"""

import logging
from typing import Any, Dict, Optional, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse

import metrics
from config import settings
from exceptions import LoadShedError
from schemas.errors import ErrorDetail, ErrorEnvelope

logger = logging.getLogger(__name__)

CELERY_QUEUE_NAME = "celery"
RETRY_AFTER_SECONDS = 30

REASON_MESSAGES = {
    "memory": "Service temporarily unavailable due to high memory pressure",
    "queue_full": "Service temporarily unavailable: task queue is at capacity",
    "broker_unavailable": "Service temporarily unavailable: task broker is unreachable",
    "provider_down": "Service temporarily unavailable: AI providers are currently down",
}


def record_shed_request(reason: str, method: str, endpoint: str) -> None:
    metrics.REQUESTS_SHED_TOTAL.labels(
        reason=reason, method=method, endpoint=endpoint
    ).inc()
    metrics.REQUEST_COUNT.labels(
        method=method, endpoint=endpoint, http_status=503
    ).inc()


def build_shed_response(
    reason: str,
    method: str,
    endpoint: str,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    record_shed_request(reason, method, endpoint)
    payload_details: Dict[str, Any] = {"reason": reason, **(details or {})}
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="SERVICE_OVERLOADED",
                message=REASON_MESSAGES.get(
                    reason, "Service temporarily unavailable due to high load"
                ),
                details=payload_details,
            )
        ).model_dump(),
    )


def get_celery_queue_depth() -> Optional[int]:
    """Return pending Celery queue depth, or None when the broker is unreachable."""
    try:
        import redis

        client = redis.from_url(
            settings.redis_url,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
        )
        client.ping()
        depth = client.llen(CELERY_QUEUE_NAME)
        if not isinstance(depth, int):
            return 0
        metrics.CELERY_QUEUE_DEPTH.set(depth)
        return depth
    except Exception as exc:
        logger.warning("Failed to check Celery queue depth: %s", exc)
        return None


def check_memory_pressure() -> Optional[str]:
    if not metrics.check_system_resources(
        memory_threshold_percent=settings.load_shed_memory_threshold_percent
    ):
        return "memory"
    return None


def check_queue_pressure() -> Optional[Tuple[str, Dict[str, Any]]]:
    if settings.app_env == "test":
        return None

    depth = get_celery_queue_depth()
    if depth is None:
        # Broker unreachable is not a queue-depth overload signal. Let the
        # request proceed so validation and enqueue logic can handle it.
        return None
    if depth >= settings.load_shed_max_celery_queue_depth:
        return "queue_full", {
            "queue_depth": depth,
            "max_queue_depth": settings.load_shed_max_celery_queue_depth,
        }
    return None


def are_llm_providers_down() -> bool:
    if settings.app_env == "test" or settings.test_provider_mode:
        return False

    try:
        import main as _main

        return _main.humanitarian_verification_service.all_providers_unavailable()
    except Exception as exc:
        logger.warning("Failed to evaluate LLM provider health: %s", exc)
        return False


def check_provider_pressure() -> Optional[str]:
    if are_llm_providers_down():
        return "provider_down"
    return None


def _is_job_creation_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/inference") or path.endswith("/ai/ocr/jobs")


def _is_llm_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/humanitarian/verify")


def evaluate_load_shed(request: Request) -> Optional[JSONResponse]:
    path = request.url.path
    method = request.method

    memory_reason = check_memory_pressure()
    if memory_reason:
        return build_shed_response(
            memory_reason,
            method,
            path,
            details={
                "threshold_percent": settings.load_shed_memory_threshold_percent,
            },
        )

    if _is_job_creation_route(path, method):
        queue_result = check_queue_pressure()
        if queue_result:
            reason, details = queue_result
            return build_shed_response(reason, method, path, details=details)

    if _is_llm_route(path, method):
        provider_reason = check_provider_pressure()
        if provider_reason:
            return build_shed_response(provider_reason, method, path)

    return None


def ensure_queue_capacity() -> None:
    queue_result = check_queue_pressure()
    if queue_result:
        reason, details = queue_result
        raise LoadShedError(
            reason,
            REASON_MESSAGES.get(reason, "Service temporarily unavailable due to high load"),
            details=details,
        )
