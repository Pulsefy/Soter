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
    "provider_degraded": "Service temporarily unavailable: AI providers are degraded",
    "queue_priority_exceeded": "Service temporarily unavailable: queue depth exceeds priority threshold",
}


def record_shed_request(
    reason: str,
    method: str,
    endpoint: str,
    queue_depth: Optional[int] = None,
    priority: Optional[str] = None,
    provider_health: Optional[str] = None,
) -> None:
    priority_label = priority or "normal"
    provider_health_label = provider_health or "unknown"
    
    metrics.REQUESTS_SHED_TOTAL.labels(
        reason=reason, method=method, endpoint=endpoint, priority=priority_label, provider_health=provider_health_label
    ).inc()
    metrics.REQUEST_COUNT.labels(
        method=method, endpoint=endpoint, http_status=503
    ).inc()
    metrics.LOAD_SHED_DECISIONS.labels(
        decision="shed", reason=reason, priority=priority_label
    ).inc()
    
    if queue_depth is not None:
        metrics.LOAD_SHED_QUEUE_DEPTH.labels(priority=priority_label).set(queue_depth)
    
    logger.info(
        "Load shed request: reason=%s method=%s endpoint=%s queue_depth=%s priority=%s provider_health=%s",
        reason,
        method,
        endpoint,
        queue_depth,
        priority,
        provider_health,
    )


def build_shed_response(
    reason: str,
    method: str,
    endpoint: str,
    details: Optional[Dict[str, Any]] = None,
) -> JSONResponse:
    queue_depth = details.get("queue_depth") if details else None
    priority = details.get("priority") if details else None
    provider_health = details.get("provider_health") if details else None
    
    record_shed_request(
        reason, method, endpoint, queue_depth, priority, provider_health
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


def check_queue_pressure(
    priority: str = "normal"
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Check queue pressure with priority-aware thresholds.
    
    Higher priority jobs get more leniency on queue depth thresholds.
    """
    if settings.app_env == "test":
        return None

    depth = get_celery_queue_depth()
    if depth is None:
        # Broker unreachable is not a queue-depth overload signal. Let the
        # request proceed so validation and enqueue logic can handle it.
        return None

    # Priority-aware threshold calculation
    if priority == "high":
        threshold = settings.load_shed_high_priority_queue_threshold
    elif priority == "low":
        threshold = int(
            settings.load_shed_max_celery_queue_depth
            * settings.load_shed_queue_priority_multiplier
        )
    else:  # normal priority
        threshold = settings.load_shed_max_celery_queue_depth

    if depth >= threshold:
        return "queue_priority_exceeded" if priority != "normal" else "queue_full", {
            "queue_depth": depth,
            "max_queue_depth": threshold,
            "priority": priority,
        }
    return None


def get_provider_health_status() -> str:
    """Get detailed provider health status.
    
    Returns:
        'healthy': All providers available
        'degraded': Some providers unavailable but not all
        'down': All providers unavailable
    """
    if settings.app_env == "test" or settings.test_provider_mode:
        return "healthy"

    try:
        import main as _main

        service = _main.humanitarian_verification_service
        providers = service.registry.available_llm_providers()
        
        if not providers:
            return "healthy"
        
        unavailable_count = sum(
            1 for p in providers if not service._get_breaker(p).allow_request()
        )
        
        if unavailable_count == 0:
            return "healthy"
        elif unavailable_count == len(providers):
            return "down"
        else:
            degradation_ratio = unavailable_count / len(providers)
            if degradation_ratio >= settings.load_shed_provider_degradation_threshold:
                return "degraded"
            return "healthy"
    except Exception as exc:
        logger.warning("Failed to evaluate LLM provider health: %s", exc)
        return "healthy"


def check_provider_pressure() -> Optional[Tuple[str, Dict[str, Any]]]:
    health_status = get_provider_health_status()
    if health_status == "down":
        return "provider_down", {"provider_health": health_status}
    elif health_status == "degraded":
        return "provider_degraded", {"provider_health": health_status}
    return None


def _is_job_creation_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/inference") or path.endswith("/ai/ocr/jobs")


def _is_llm_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/humanitarian/verify")


def _extract_priority_from_request(request: Request) -> str:
    """Extract job priority from request body if available."""
    try:
        if hasattr(request, "_json") and request._json:
            return request._json.get("priority", "normal")
    except Exception:
        pass
    return "normal"

def evaluate_load_shed(request: Request) -> Optional[JSONResponse]:
    path = request.url.path
    method = request.method
    priority = _extract_priority_from_request(request)

    memory_reason = check_memory_pressure()
    if memory_reason:
        return build_shed_response(
            memory_reason,
            method,
            path,
            details={
                "threshold_percent": settings.load_shed_memory_threshold_percent,
                "priority": priority,
            },
        )

    if _is_job_creation_route(path, method):
        queue_result = check_queue_pressure(priority=priority)
        if queue_result:
            reason, details = queue_result
            return build_shed_response(reason, method, path, details=details)
        # Record that the request was allowed through
        metrics.LOAD_SHED_DECISIONS.labels(
            decision="allow", reason="queue_ok", priority=priority
        ).inc()

    if _is_llm_route(path, method):
        provider_result = check_provider_pressure()
        if provider_result:
            reason, details = provider_result
            return build_shed_response(reason, method, path, details=details)
        # Record that the request was allowed through
        metrics.LOAD_SHED_DECISIONS.labels(
            decision="allow", reason="provider_ok", priority=priority
        ).inc()

    return None


def ensure_queue_capacity(priority: str = "normal") -> None:
    queue_result = check_queue_pressure(priority=priority)
    if queue_result:
        reason, details = queue_result
        raise LoadShedError(
            reason,
            REASON_MESSAGES.get(
                reason, "Service temporarily unavailable due to high load"
            ),
            details=details,
        )
