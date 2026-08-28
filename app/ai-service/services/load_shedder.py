"""
Load-shedding for the AI service under pressure (Issue #621, #777).

Rejects incoming work with HTTP 503 and a standardized error envelope when
system memory, the Celery queue, or configured LLM providers are overloaded.

#777 enhancements:
  - Tiered queue-depth thresholds keyed by job priority (low/normal/high).
  - Granular provider health scoring (healthy / degraded / unavailable) that
    accounts for the fraction of configured providers whose circuits are open.
  - Job priority (``X-Job-Priority`` header or request body) is consulted so
    high-priority work survives moderate pressure.
  - Detailed metrics labels record *why* and *when* each request was shed,
    including priority tier, queue tier, and provider pool state.
"""

import logging
import time
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
    "queue_full_low": "Service temporarily unavailable: low-priority queue at capacity",
    "queue_full_normal": "Service temporarily unavailable: normal-priority queue at capacity",
    "queue_full_high": "Service temporarily unavailable: high-priority queue at capacity",
    "broker_unavailable": "Service temporarily unavailable: task broker is unreachable",
    "provider_down": "Service temporarily unavailable: AI providers are currently down",
    "provider_degraded": "Service temporarily unavailable: AI provider pool is degraded",
}

VALID_PRIORITIES = {"low", "normal", "high"}
DEFAULT_PRIORITY = "normal"


def _normalize_priority(raw: Optional[str]) -> str:
    if not raw:
        return DEFAULT_PRIORITY
    cooked = str(raw).strip().lower()
    return cooked if cooked in VALID_PRIORITIES else DEFAULT_PRIORITY


def _queue_threshold_for_priority(priority: str) -> int:
    priority = _normalize_priority(priority)
    if priority == "high":
        return settings.load_shed_queue_depth_high_priority
    if priority == "low":
        return settings.load_shed_queue_depth_low_priority
    return settings.load_shed_queue_depth_normal_priority


def _queue_tier_for_depth(depth: int) -> str:
    if depth >= settings.load_shed_queue_depth_high_priority:
        return "high_exceeded"
    if depth >= settings.load_shed_queue_depth_normal_priority:
        return "normal_exceeded"
    if depth >= settings.load_shed_queue_depth_low_priority:
        return "low_exceeded"
    return "ok"


def record_shed_request(
    reason: str,
    method: str,
    endpoint: str,
    priority: str = DEFAULT_PRIORITY,
    queue_tier: str = "unknown",
    provider_state: str = "unknown",
) -> None:
    metrics.REQUESTS_SHED_TOTAL.labels(
        reason=reason, method=method, endpoint=endpoint
    ).inc()
    metrics.REQUESTS_SHED_DETAIL.labels(
        reason=reason,
        method=method,
        endpoint=endpoint,
        priority=_normalize_priority(priority),
        queue_tier=queue_tier,
        provider_state=provider_state,
    ).inc()
    metrics.REQUEST_COUNT.labels(
        method=method, endpoint=endpoint, http_status=503
    ).inc()


def build_shed_response(
    reason: str,
    method: str,
    endpoint: str,
    details: Optional[Dict[str, Any]] = None,
    priority: str = DEFAULT_PRIORITY,
    queue_tier: str = "unknown",
    provider_state: str = "unknown",
) -> JSONResponse:
    record_shed_request(reason, method, endpoint, priority, queue_tier, provider_state)
    payload_details: Dict[str, Any] = {
        "reason": reason,
        "shed_at": int(time.time()),
        "priority": _normalize_priority(priority),
        **(details or {}),
    }
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
        tier_name = _queue_tier_for_depth(depth)
        tier_value = {
            "ok": 0,
            "low_exceeded": 1,
            "normal_exceeded": 2,
            "high_exceeded": 3,
        }.get(tier_name, 0)
        metrics.CELERY_QUEUE_TIER.set(tier_value)
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
    priority: str = DEFAULT_PRIORITY,
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Queue-aware pressure check that uses the priority-tiered threshold.

    Returns ``(reason, details)`` when the queue depth exceeds the threshold
    appropriate for the given priority level, or ``None`` when the request
    should be admitted.
    """
    if settings.app_env == "test":
        return None

    depth = get_celery_queue_depth()
    if depth is None:
        return None

    normalized_priority = _normalize_priority(priority)
    threshold = _queue_threshold_for_priority(normalized_priority)
    queue_tier = _queue_tier_for_depth(depth)

    if depth >= threshold:
        reason_suffix = "" if normalized_priority == "normal" else f"_{normalized_priority}"
        if depth >= settings.load_shed_queue_depth_high_priority:
            reason = "queue_full_high"
        elif depth >= settings.load_shed_queue_depth_normal_priority:
            reason = "queue_full_normal"
        else:
            reason = "queue_full_low"
        return reason, {
            "queue_depth": depth,
            "queue_tier": queue_tier,
            "threshold_applied": threshold,
            "priority": normalized_priority,
            "thresholds": {
                "low": settings.load_shed_queue_depth_low_priority,
                "normal": settings.load_shed_queue_depth_normal_priority,
                "high": settings.load_shed_queue_depth_high_priority,
            },
        }
    return None


def _get_provider_registry_and_breakers() -> Optional[Tuple[Any, Dict[str, Any]]]:
    """Return (registry, breakers_dict) from the live verification service."""
    try:
        import main as _main

        svc = _main.humanitarian_verification_service
        return svc.registry, svc.breakers
    except Exception as exc:
        logger.warning("Failed to access provider registry: %s", exc)
        return None


def get_provider_health() -> Tuple[str, int, int]:
    """Evaluate the LLM provider pool health.

    Returns a tuple ``(state, available_count, configured_count)`` where
    ``state`` is one of ``"healthy"``, ``"degraded"``, or ``"unavailable"``.
    """
    if settings.app_env == "test" or settings.test_provider_mode:
        return "healthy", 1, 1

    access = _get_provider_registry_and_breakers()
    if access is None:
        return "healthy", 0, 0

    registry, breakers = access
    configured = registry.available_llm_providers()
    configured_count = len(configured)
    if configured_count == 0:
        return "healthy", 0, 0

    available_count = 0
    for name in configured:
        breaker = breakers.get(name)
        if breaker is None or breaker.allow_request():
            available_count += 1

    metrics.PROVIDER_CONFIGURED_COUNT.labels(capability="llm").set(configured_count)
    metrics.PROVIDER_AVAILABLE_COUNT.labels(capability="llm").set(available_count)

    if available_count == 0:
        state = "unavailable"
        metrics.PROVIDER_HEALTH_STATE.set(2)
    elif available_count / configured_count < settings.load_shed_provider_degraded_ratio:
        state = "degraded"
        metrics.PROVIDER_HEALTH_STATE.set(1)
    else:
        state = "healthy"
        metrics.PROVIDER_HEALTH_STATE.set(0)

    return state, available_count, configured_count


def are_llm_providers_down() -> bool:
    """Legacy binary helper — True only when the pool is fully unavailable."""
    state, _, _ = get_provider_health()
    return state == "unavailable"


def check_provider_pressure(
    priority: str = DEFAULT_PRIORITY,
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Provider-aware pressure check that accounts for degraded pools.

    * ``unavailable`` — shed every priority level.
    * ``degraded``    — shed only ``low`` priority so higher tiers proceed.
    * ``healthy``     — admit everything.
    """
    state, available_count, configured_count = get_provider_health()
    normalized_priority = _normalize_priority(priority)

    if state == "unavailable":
        return "provider_down", {
            "provider_state": state,
            "available_count": available_count,
            "configured_count": configured_count,
            "priority": normalized_priority,
        }

    if state == "degraded" and normalized_priority == "low":
        return "provider_degraded", {
            "provider_state": state,
            "available_count": available_count,
            "configured_count": configured_count,
            "degraded_ratio_threshold": settings.load_shed_provider_degraded_ratio,
            "priority": normalized_priority,
        }

    return None


def _is_job_creation_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/inference") or path.endswith("/ai/ocr/jobs")


def _is_llm_route(path: str, method: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.endswith("/ai/humanitarian/verify")


def _extract_priority(request: Request) -> str:
    """Best-effort priority extraction without consuming the request body.

    Prefers the lightweight ``X-Job-Priority`` header so the middleware can
    decide before reading the (possibly large) body.  Falls back to
    ``"normal"`` when the header is absent.
    """
    header_value = request.headers.get("x-job-priority")
    return _normalize_priority(header_value)


def evaluate_load_shed(request: Request) -> Optional[JSONResponse]:
    """Top-level load-shedding evaluator invoked by the HTTP middleware."""
    start = time.time()
    path = request.url.path
    method = request.method

    priority = _extract_priority(request)
    queue_tier = "unknown"
    provider_state = "unknown"

    try:
        memory_reason = check_memory_pressure()
        if memory_reason:
            return build_shed_response(
                memory_reason,
                method,
                path,
                details={
                    "threshold_percent": settings.load_shed_memory_threshold_percent,
                },
                priority=priority,
                queue_tier=queue_tier,
                provider_state=provider_state,
            )

        if _is_job_creation_route(path, method):
            queue_result = check_queue_pressure(priority)
            if queue_result:
                reason, details = queue_result
                queue_tier = details.get("queue_tier", queue_tier)
                return build_shed_response(
                    reason,
                    method,
                    path,
                    details=details,
                    priority=priority,
                    queue_tier=queue_tier,
                    provider_state=provider_state,
                )

        if _is_llm_route(path, method):
            provider_result = check_provider_pressure(priority)
            if provider_result:
                reason, details = provider_result
                provider_state = details.get("provider_state", provider_state)
                return build_shed_response(
                    reason,
                    method,
                    path,
                    details=details,
                    priority=priority,
                    queue_tier=queue_tier,
                    provider_state=provider_state,
                )

        # For LLM routes, also consider queue pressure when applicable.
        if _is_llm_route(path, method):
            queue_result = check_queue_pressure(priority)
            if queue_result:
                reason, details = queue_result
                queue_tier = details.get("queue_tier", queue_tier)
                return build_shed_response(
                    reason,
                    method,
                    path,
                    details=details,
                    priority=priority,
                    queue_tier=queue_tier,
                    provider_state=provider_state,
                )

        return None
    finally:
        elapsed = time.time() - start
        metrics.LOAD_SHED_LATENCY.labels(endpoint=path).observe(elapsed)


def ensure_queue_capacity(priority: str = DEFAULT_PRIORITY) -> None:
    """Raise :class:`LoadShedError` when the queue is past the tiered threshold.

    Used by synchronous task-creation paths (``tasks.create_task``) that do
    not route through the HTTP middleware.  Accepts an explicit priority
    extracted from the task payload by the caller.
    """
    queue_result = check_queue_pressure(priority)
    if queue_result:
        reason, details = queue_result
        raise LoadShedError(
            reason,
            REASON_MESSAGES.get(
                reason, "Service temporarily unavailable due to high load"
            ),
            details=details,
        )
