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
    "queue_high": "Service temporarily unavailable: task queue is under high load",
    "broker_unavailable": "Service temporarily unavailable: task broker is unreachable",
    "provider_down": "Service temporarily unavailable: AI providers are currently down",
    "provider_degraded": "Service temporarily unavailable: AI providers are degraded",
}


def record_shed_request(
    reason: str,
    method: str,
    endpoint: str,
    queue_depth: Optional[int] = None,
    provider_health: Optional[str] = None,
    priority: Optional[str] = None,
) -> None:
    # Bound the raw request path to its route template before it becomes a
    # label value (see metrics.py's cardinality guidance, issue #988).
    bounded_endpoint = metrics.bounded_endpoint_label(endpoint)
    metrics.REQUESTS_SHED_TOTAL.labels(
        reason=reason, method=method, endpoint=bounded_endpoint
    ).inc()
    metrics.REQUEST_COUNT.labels(
        method=method, endpoint=bounded_endpoint, http_status=503
    ).inc()
    # Record additional context for shed decisions
    if queue_depth is not None:
        metrics.LOAD_SHED_QUEUE_DEPTH.observe(queue_depth)
    if provider_health is not None:
        metrics.LOAD_SHED_PROVIDER_HEALTH.labels(provider_health=provider_health).inc()
    if priority is not None:
        metrics.LOAD_SHED_BY_PRIORITY.labels(priority=priority).inc()


def build_shed_response(
    reason: str,
    method: str,
    endpoint: str,
    details: Optional[Dict[str, Any]] = None,
    queue_depth: Optional[int] = None,
    provider_health: Optional[str] = None,
    priority: Optional[str] = None,
) -> JSONResponse:
    record_shed_request(
        reason, method, endpoint, queue_depth, provider_health, priority
    )
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

    # Graduated queue depth thresholds
    if depth >= settings.load_shed_max_celery_queue_depth:
        return "queue_full", {
            "queue_depth": depth,
            "max_queue_depth": settings.load_shed_max_celery_queue_depth,
        }

    # Check for high queue pressure (intermediate threshold)
    high_threshold = getattr(settings, "load_shed_high_celery_queue_depth", None)
    if high_threshold and depth >= high_threshold:
        return "queue_high", {
            "queue_depth": depth,
            "high_threshold": high_threshold,
        }

    return None


def get_llm_provider_health() -> Optional[str]:
    """Return provider health status: 'down', 'degraded', or None (healthy).

    This provides a graduated signal instead of binary down/healthy.
    """
    if settings.app_env == "test" or settings.test_provider_mode:
        return None

    try:
        import main as _main

        service = _main.humanitarian_verification_service
        if service.all_providers_unavailable():
            return "down"

        # Check if providers are degraded (some failing but not all)
        # This is a heuristic based on circuit breaker state
        if hasattr(service, "get_provider_failure_rate"):
            failure_rate = service.get_provider_failure_rate()
            degraded_threshold = getattr(
                settings, "load_shed_provider_degraded_threshold", 0.3
            )
            if failure_rate >= degraded_threshold:
                return "degraded"
    except Exception as exc:
        logger.warning("Failed to evaluate LLM provider health: %s", exc)
        return None

    return None


def check_provider_pressure() -> Optional[Tuple[str, Dict[str, Any]]]:
    health_status = get_llm_provider_health()
    if health_status == "down":
        return "provider_down", {"provider_health": health_status}
    elif health_status == "degraded":
        return "provider_degraded", {"provider_health": health_status}
    return None


def _is_job_creation_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith(("/ai/inference", "/ai/ocr/jobs"))


def _is_llm_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/humanitarian/verify")


def _extract_priority_from_request(request: Request) -> str:
    """Extract job priority from request, defaulting to 'normal'."""
    try:
        # Try to parse JSON body to extract priority
        import json

        body = request._body.decode("utf-8") if request._body else "{}"
        payload = json.loads(body)
        priority = payload.get("priority", "normal")
        # Bound priority to known values
        if priority not in ("low", "normal", "high"):
            priority = "normal"
        return priority
    except Exception:
        return "normal"


def _get_shed_thresholds() -> tuple:
    """Get configured shedding thresholds."""
    high_threshold = getattr(settings, "load_shed_high_celery_queue_depth", None)
    low_threshold = getattr(settings, "load_shed_low_celery_queue_depth", None)
    max_threshold = settings.load_shed_max_celery_queue_depth
    return high_threshold, low_threshold, max_threshold


def _should_shed_based_on_priority(
    priority: str, queue_depth: Optional[int] = None
) -> bool:
    """Determine if a request should be shed based on priority and queue depth.

    High priority requests are only shed under extreme conditions.
    Normal priority requests are shed under high conditions.
    Low priority requests are shed more aggressively.
    """
    if queue_depth is None:
        return False

    high_threshold, low_threshold, max_threshold = _get_shed_thresholds()

    # Priority-based shedding rules
    if priority == "high":
        return queue_depth >= max_threshold

    if priority == "normal":
        return queue_depth >= max_threshold or (
            high_threshold and queue_depth >= high_threshold
        )

    if priority == "low":
        return (low_threshold and queue_depth >= low_threshold) or (
            high_threshold and queue_depth >= high_threshold
        )

    return False


def evaluate_load_shed(request: Request) -> Optional[JSONResponse]:
    path = request.url.path
    method = request.method
    priority = _extract_priority_from_request(request)
    queue_depth = get_celery_queue_depth()

    memory_reason = check_memory_pressure()
    if memory_reason:
        # Memory pressure sheds all requests regardless of priority
        return build_shed_response(
            memory_reason,
            method,
            path,
            details={
                "threshold_percent": settings.load_shed_memory_threshold_percent,
            },
            queue_depth=queue_depth,
            priority=priority,
        )

    if _is_job_creation_route(path, method):
        queue_result = check_queue_pressure()
        if queue_result:
            reason, details = queue_result
            # Apply priority-based shedding for queue pressure
            if _should_shed_based_on_priority(priority, queue_depth):
                return build_shed_response(
                    reason,
                    method,
                    path,
                    details=details,
                    queue_depth=queue_depth,
                    priority=priority,
                )

    if _is_llm_route(path, method):
        provider_result = check_provider_pressure()
        if provider_result:
            reason, details = provider_result
            # Provider degradation sheds all requests (no priority exemption)
            return build_shed_response(
                reason,
                method,
                path,
                details=details,
                provider_health=details.get("provider_health"),
                priority=priority,
            )

    return None


def ensure_queue_capacity(priority: str = "normal") -> None:
    queue_result = check_queue_pressure()
    if queue_result:
        reason, details = queue_result
        queue_depth = details.get("queue_depth")
        # Apply priority-based shedding
        if _should_shed_based_on_priority(priority, queue_depth):
            raise LoadShedError(
                reason,
                REASON_MESSAGES.get(
                    reason, "Service temporarily unavailable due to high load"
                ),
                details=details,
            )
