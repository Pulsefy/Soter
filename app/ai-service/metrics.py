"""
Prometheus Metrics for the AI Service.

Guidance for adding new metrics:
- Ensure all labels have a strict, small cardinality bound (e.g., < 50 unique values).
- NEVER use unbounded values like UUIDs, claim IDs, artifact IDs, error strings, or user input as labels.
- For API paths, use the matched route template (e.g., /v1/claims/{claim_id}) rather than the raw URL path.
- The /metrics endpoint response size must be kept small (ideally < 1MB) to ensure scrape reliability.
- If you need to track unbounded values, use structured logging instead of metrics.
"""
import logging
import psutil
from fastapi import Request
from starlette.routing import Match
from prometheus_client import Counter, Histogram, Gauge

logger = logging.getLogger(__name__)

def get_route_path(request: Request) -> str:
    """
    Get the matched route path template (e.g., /v1/items/{item_id}) to prevent cardinality explosion.
    If no route is matched, returns 'unmatched_route'.
    """
    for route in request.app.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return getattr(route, "path", "unmatched_route")
    return "unmatched_route"

# System metrics
MEMORY_USAGE_PERCENT = Gauge(
    "system_memory_usage_percent", "System memory usage percentage"
)
VRAM_USAGE_PERCENT = Gauge("system_vram_usage_percent", "System VRAM usage percentage")

# API metrics
REQUEST_COUNT = Counter(
    "api_request_count",
    "Total API request count",
    ["method", "endpoint", "http_status"],
)
REQUEST_LATENCY = Histogram(
    "api_request_latency_seconds", "API request latency", ["method", "endpoint"]
)
REQUESTS_SHED_TOTAL = Counter(
    "requests_shed_total",
    "Requests rejected due to overload (load shedding)",
    ["reason", "method", "endpoint"],
)
CELERY_QUEUE_DEPTH = Gauge(
    "celery_queue_depth", "Pending tasks in the Celery default queue"
)

# Dead-letter queue metrics
DEAD_LETTER_ITEMS_TOTAL = Counter(
    "dead_letter_items_total",
    "Items added to the dead-letter queue",
    ["kind"],
)
DEAD_LETTER_REPLAY_ATTEMPTS_TOTAL = Counter(
    "dead_letter_replay_attempts_total",
    "Dead-letter replay attempts",
    ["kind", "outcome"],
)

# AI Model metrics
MODEL_LOAD_TIME = Histogram(
    "model_load_time_seconds", "Model load time in seconds", ["model_name"]
)
INFERENCE_LATENCY = Histogram(
    "inference_latency_seconds", "Inference latency in seconds", ["task_type"]
)
PIPELINE_STEP_LATENCY = Histogram(
    "pipeline_step_latency_seconds", "Pipeline step latency in seconds", ["step_name"]
)

JOB_CANCELLED_TOTAL = Counter(
    "job_cancelled_total", "Total jobs cancelled", ["task_type"]
)
JOB_EXPIRED_TOTAL = Counter("job_expired_total", "Total jobs expired", ["task_type"])

# Cache invalidation metrics
CACHE_INVALIDATION_TOTAL = Counter(
    "cache_invalidation_total",
    "Cache invalidation operations performed",
    ["reason"],
)


def check_system_resources(memory_threshold_percent: float = 90.0) -> bool:
    """
    Check if system RAM or VRAM is above threshold.
    Returns True if resources are healthy, False if exhausted.
    """
    # RAM check
    ram = psutil.virtual_memory()
    MEMORY_USAGE_PERCENT.set(ram.percent)

    # Try VRAM check if torch is available
    vram_percent = 0.0
    try:
        import torch

        if torch.cuda.is_available():
            vram_used = torch.cuda.memory_allocated()
            vram_total = torch.cuda.get_device_properties(0).total_memory
            if vram_total > 0:
                vram_percent = (vram_used / vram_total) * 100
                VRAM_USAGE_PERCENT.set(vram_percent)
    except ImportError:
        pass

    if ram.percent > memory_threshold_percent or (
        vram_percent and vram_percent > memory_threshold_percent
    ):
        logger.warning(
            f"Resource exhaustion detected! RAM: {ram.percent}%, VRAM: {vram_percent}%"
        )
        return False

    return True
