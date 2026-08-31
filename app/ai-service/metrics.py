"""
Prometheus metrics for the AI service (issue #988: bounded label cardinality).

## Cardinality guidance for adding new metrics

Every label attached to a metric multiplies the number of time series
Prometheus stores for it. A label whose value space is not fixed at
deploy time (an id, a raw request path, a free-text error message, a
client-supplied string, a timestamp, a hash) is an *unbounded* label:
each new distinct value permanently adds a new time series that never
expires, and enough of them turns `/metrics` into an availability
problem (slow scrapes, memory growth, dropped scrapes).

Before adding a `.labels(...)` call, ask: **could this label take more
than a few dozen distinct values over the service's lifetime?** If yes,
it must be bounded before it reaches `.labels()`:

- **Request paths** (`endpoint`/`path` labels): never pass
  `request.url.path` or an ASGI `scope["path"]` directly — path
  parameters (task ids, artifact ids, session ids, ...) make it
  unbounded. Use `bounded_endpoint_label(raw_path)`, which maps the raw
  path to its registered FastAPI route *template* (e.g.
  `/v1/ai/status/{task_id}`, not `/v1/ai/status/<uuid>`), so cardinality
  is capped at the fixed number of routes the app registers at startup.
- **Task/job/model type strings sourced from a request payload**: never
  pass a client-supplied string straight through. Route it through a
  bounding helper (see `bounded_task_type`) that maps known values
  through unchanged and collapses everything else into a fixed
  `"other"` bucket.
- **Error messages / exception text**: never use `str(exc)` as a label
  value. Classify the exception into a small, fixed category first (see
  the `app/backend` precedent in
  `src/notifications/notification-failure-classifier.ts` for the same
  pattern applied to Node) — or omit the label and log the raw message
  instead, since logs (unlike metric label sets) are not indexed by
  cardinality.
- **Already-bounded values are fine as labels directly**: HTTP methods,
  status codes, a handful of hardcoded reason/outcome/kind literals, a
  small fixed provider/model registry defined in code (not user input).
  These are safe because the *set of possible values* is fixed by the
  code, not by runtime input.

`tests/test_metrics_cardinality.py` enforces this: it asserts that
`REQUEST_COUNT`/`REQUEST_LATENCY`/`REQUESTS_SHED_TOTAL`/
`REQUEST_REJECTIONS_TOTAL`/`RATE_LIMIT_EXCEEDED_TOTAL`'s `endpoint` label
and `INFERENCE_LATENCY`'s `task_type` label only ever take values from a
bounded set, and that a burst of requests against id-bearing routes does
not blow up `/ai/metrics`'s response size. See `METRICS_CARDINALITY.md`
for the full per-metric audit.
"""

import logging
import re
from typing import Any, List, Optional, Tuple

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
REQUEST_REJECTIONS_TOTAL = Counter(
    "api_request_rejections_total",
    "Requests rejected or constrained by request safety limits",
    ["endpoint", "reason"],
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
IMAGE_QUALITY_REJECTION_TOTAL = Counter(
    "image_quality_rejection_total",
    "Total images rejected by quality gates before inference",
    ["reason"],
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
    bounded = bounded_endpoint_label(endpoint)
    RATE_LIMIT_EXCEEDED_TOTAL.labels(endpoint=bounded, method=method).inc()
    REQUEST_COUNT.labels(method=method, endpoint=bounded, http_status=429).inc()


# --- Label cardinality bounding helpers (issue #988) ---
#
# See the module docstring above for when/why to use these.

_APP: Optional[Any] = None
_ROUTE_LABEL_PATTERNS: Optional[List[Tuple["re.Pattern[str]", str]]] = None

#: Fallback label used for a raw path that does not match any route the app
#: registered at startup (404s, health-probe typos, or requests rejected by
#: middleware before Starlette's router ever ran). Keeps the `endpoint`
#: label bounded even for traffic that never resolved to a real route.
UNMATCHED_ENDPOINT_LABEL = "unmatched"


def bind_app(app: Any) -> None:
    """
    Registers the running FastAPI app so `bounded_endpoint_label` can map a
    raw request path to its registered route template.

    Call exactly once, right after constructing the app in `main.py` —
    before any request is served. Safe to call again (e.g. a test building
    a fresh app instance); it invalidates the cached route table so the new
    app's routes take effect on the next lookup.
    """
    global _APP, _ROUTE_LABEL_PATTERNS
    _APP = app
    _ROUTE_LABEL_PATTERNS = None


def _route_label_patterns() -> List[Tuple["re.Pattern[str]", str]]:
    global _ROUTE_LABEL_PATTERNS
    if _ROUTE_LABEL_PATTERNS is None:
        patterns: List[Tuple["re.Pattern[str]", str]] = []
        for route in getattr(_APP, "routes", None) or []:
            regex = getattr(route, "path_regex", None)
            template = getattr(route, "path", None)
            if regex is not None and template is not None:
                patterns.append((regex, template))
        _ROUTE_LABEL_PATTERNS = patterns
    return _ROUTE_LABEL_PATTERNS


def bounded_endpoint_label(raw_path: str) -> str:
    """
    Maps a raw request path (which may embed an unbounded id, e.g.
    ``/v1/ai/status/9f2c...``) to its registered route *template* (e.g.
    ``/v1/ai/status/{task_id}``) for safe use as a Prometheus ``endpoint``
    label.

    Cardinality is bounded by the fixed number of routes the app registers
    at startup, not by the number of task/artifact/dead-letter-item ids
    ever created. A path that does not match any registered route —
    including one rejected by middleware before routing ran — collapses to
    `UNMATCHED_ENDPOINT_LABEL` rather than leaking the raw path. Returns
    `UNMATCHED_ENDPOINT_LABEL` if called before `bind_app`.
    """
    for regex, template in _route_label_patterns():
        if regex.match(raw_path):
            return template
    return UNMATCHED_ENDPOINT_LABEL


#: Task types with a dedicated, code-defined handling branch (see
#: `tasks.py`'s heavy-inference dispatch and the literal `task_type` values
#: used across `api/routes.py`, `services/ocr_job.py`, and
#: `proof_of_life.py`). Anything outside this set is client-influenced
#: (`InferenceRequest.type` is an unrestricted string) and must not reach
#: `.labels()` unchanged.
_KNOWN_TASK_TYPES = frozenset(
    {
        "inference",
        "ocr",
        "image_analysis",
        "model_inference",
        "humanitarian_verification",
        "batch_processing",
        "proof_of_life",
    }
)

#: Fallback label for any task type outside `_KNOWN_TASK_TYPES`.
OTHER_TASK_TYPE_LABEL = "other"


def bounded_task_type(task_type: str) -> str:
    """
    Maps an inference task type to a bounded Prometheus label value.

    `task_type` may originate from a client-supplied request payload (see
    `InferenceRequest.type` in `api/v1/inference.py`, which accepts any
    string); anything outside `_KNOWN_TASK_TYPES` collapses to
    `OTHER_TASK_TYPE_LABEL` so a caller cannot grow this label's
    cardinality via arbitrary input.
    """
    return task_type if task_type in _KNOWN_TASK_TYPES else OTHER_TASK_TYPE_LABEL


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
