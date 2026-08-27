import logging
import psutil
from prometheus_client import Counter, Histogram, Gauge

logger = logging.getLogger(__name__)

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
RATE_LIMIT_EXCEEDED_TOTAL = Counter(
    "rate_limit_exceeded_total",
    "Requests rejected due to rate limiting",
    ["endpoint", "method"],
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


def record_rate_limit_exceeded(endpoint: str, method: str) -> None:
    """Record a rejected rate limit request."""
    RATE_LIMIT_EXCEEDED_TOTAL.labels(endpoint=endpoint, method=method).inc()
    REQUEST_COUNT.labels(method=method, endpoint=endpoint, http_status=429).inc()


# Evidence upload/artifact retention purge metrics
UPLOAD_PURGE_ITEMS_TOTAL = Counter(
    "upload_purge_items_total",
    "Items removed by the evidence upload/artifact purge job",
    ["kind"],
)
UPLOAD_PURGE_BYTES_RECLAIMED_TOTAL = Counter(
    "upload_purge_bytes_reclaimed_total",
    "Bytes reclaimed by the evidence upload/artifact purge job",
    ["kind"],
)

# Cache stampede prevention metrics
SINGLE_FLIGHT_SUPPRESSED = Counter(
    "cache_single_flight_suppressed_total",
    "Total number of concurrent cache misses suppressed by single-flight mechanism",
    ["prefix"],
)
SINGLE_FLIGHT_COMPLETED = Counter(
    "cache_single_flight_completed_total",
    "Total number of single-flight computations completed",
    ["prefix"],
)
SINGLE_FLIGHT_FAILED = Counter(
    "cache_single_flight_failed_total",
    "Total number of single-flight computations that failed",
    ["prefix"],
)
