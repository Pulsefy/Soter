# Prometheus Metric Label Cardinality Audit (issue #988)

This is the canonical, per-metric audit of every Prometheus metric exposed
by the AI service at `GET /ai/metrics`. It exists so that (a) anyone
reviewing a new metric can see the bounding convention already in use, and
(b) a metric's cardinality can be reasoned about without re-deriving it
from every call site.

Metrics are defined in [`metrics.py`](./metrics.py), with one exception
(`circuit_breaker_state`, defined in
[`services/circuit_breaker.py`](./services/circuit_breaker.py)) noted
below. See [`metrics.py`](./metrics.py)'s module docstring for the rule of
thumb on when a label needs bounding, and
[`tests/test_metrics_cardinality.py`](./tests/test_metrics_cardinality.py)
for the tests that enforce it.

## How to read the "Bound" column

- **Fixed literal(s)** — every call site passes a hardcoded string
  constant. The value set is exactly what's visible in this table and
  cannot grow without a code change.
- **Fixed enum (N)** — the label takes one of a small, closed set of N
  values defined in code (an `Enum`, a tuple of states, a small hardcoded
  registry). Not user input.
- **Bounded via `bounded_endpoint_label`** — the raw value (a request path)
  is mapped to its registered FastAPI route *template* before reaching
  `.labels()`. Cardinality is capped at the number of routes the app
  registers at startup (currently ~35), not the number of ids ever seen.
- **Bounded via `bounded_task_type`** — the raw value is checked against a
  fixed allowlist; anything else collapses to `"other"`.
- **UNBOUNDED (fixed, issue #988)** — this was an unbounded label before
  this issue; the "Fix" column says what changed.

## Metric inventory

| Metric | Type | Labels | Label → Bound | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `system_memory_usage_percent` | Gauge | *(none)* | n/a | |
| `system_vram_usage_percent` | Gauge | *(none)* | n/a | |
| `api_request_count` (`REQUEST_COUNT`) | Counter | `method` | Fixed enum (HTTP verbs) | |
| | | `endpoint` | **Bounded via `bounded_endpoint_label`** | Was raw `request.url.path` (unbounded: task/artifact/item ids in the path). Fixed in `main.py`'s `monitor_requests`. |
| | | `http_status` | Fixed enum (HTTP status codes) | |
| `api_request_latency_seconds` (`REQUEST_LATENCY`) | Histogram | `method`, `endpoint` | Same as above | Same fix, same call site. |
| `requests_shed_total` (`REQUESTS_SHED_TOTAL`) | Counter | `reason` | Fixed literals: `memory`, `queue_full`, `broker_unavailable`, `provider_down` | See `services/load_shedder.py:REASON_MESSAGES`. |
| | | `method` | Fixed enum | |
| | | `endpoint` | **Bounded via `bounded_endpoint_label`** | Was raw path. Fixed in `services/load_shedder.py:record_shed_request`. |
| `api_request_rejections_total` (`REQUEST_REJECTIONS_TOTAL`) | Counter | `endpoint` | **Bounded via `bounded_endpoint_label`** | Was raw path (both call sites: `clamp_request_timeout`, and `RequestSizeLimitMiddleware._reject`, which runs *before* FastAPI routing — `bounded_endpoint_label` still resolves it correctly because it matches against the app's compiled route regexes directly, not live routing state). |
| | | `reason` | Fixed literals: `timeout_clamped`, `request_body_too_large` | |
| `rate_limit_exceeded_total` (`RATE_LIMIT_EXCEEDED_TOTAL`) | Counter | `endpoint` | **Bounded via `bounded_endpoint_label`** | Was raw path (`RateLimitResult.endpoint`, itself still raw — kept that way since it's also used for rate-limit bucketing/logging, not just metrics). Bounding happens inside `metrics.record_rate_limit_exceeded`, so callers don't need to remember to bound it themselves. |
| | | `method` | Fixed enum | |
| `celery_queue_depth` | Gauge | *(none)* | n/a | |
| `dead_letter_items_total` (`DEAD_LETTER_ITEMS_TOTAL`) | Counter | `kind` | Fixed literals: `async_job`, `callback` (`tasks.py`) | |
| `dead_letter_replay_attempts_total` | Counter | `kind` | Same as above, read back off `DeadLetterEntry.kind` | Only ever constructed with the two literals above. |
| | | `outcome` | Fixed enum (2): `succeeded`, `failed` | |
| `model_load_time_seconds` (`MODEL_LOAD_TIME`) | Histogram | `model_name` | Fixed literals today: `haarcascade_frontalface`, `haarcascade_eye` (`proof_of_life.py`) | **Watch item**: safe today because both call sites are hardcoded. If a future call site ever passes a runtime model/version string here, it must go through a `bounded_task_type`-style allowlist first — do not assume this label is inherently safe just because it's called `model_name`. |
| `inference_latency_seconds` (`INFERENCE_LATENCY`) | Histogram | `task_type` | **Bounded via `bounded_task_type`** | Was unbounded in `tasks.py`'s heavy-inference task: `task_type = payload.get("type", "inference")` flows from the client-supplied `InferenceRequest.type` field (`api/v1/inference.py`), an unrestricted `str` with no `Literal`/enum validation. This was the clearest cardinality bug found by this audit. Fixed at the single call site in `tasks.py`. Other call sites (`api/routes.py`, `services/ocr_job.py`, `proof_of_life.py`) already pass fixed literals and are unaffected. |
| `pipeline_step_latency_seconds` | Histogram | `step_name` | Fixed literals: `preprocess`, `ocr`, `scrub`, `verify` | One call site each, all hardcoded. |
| `job_cancelled_total` | Counter | `task_type` | Fixed enum (2): `unknown`, `inference` | Computed as a local variable in `api/v1/inference.py`, not read from the client payload — different from `INFERENCE_LATENCY`'s bug above. |
| `job_expired_total` | Counter | `task_type` | Same as above | |
| `cache_invalidation_total` | Counter | `reason` | Fixed literals: `task_status`, `artifact_access`, `artifact_updated`, `model_version_changed`, `all` | |
| `upload_purge_items_total` | Counter | `kind` | Fixed literals: `session`, `artifact` | |
| `upload_purge_bytes_reclaimed_total` | Counter | `kind` | Same as above | |
| `cache_single_flight_suppressed_total` / `_completed_total` / `_failed_total` | Counter | `prefix` | Fixed enum, developer-defined | `prefix` is the `@cached_response(prefix=...)` decorator argument — a small, code-controlled set of cache namespaces, never user input. |
| `circuit_breaker_state` (defined in `services/circuit_breaker.py`, not `metrics.py`) | Gauge | `provider` | Fixed enum (~4): the hardcoded `ProviderRegistry` in `services/providers.py` (`OpenAIProvider`, `GroqProvider`, `FixtureProvider`, `TesseractOCRProvider`) | Not user input; the provider registry is configured in code. |
| | | `state` | Fixed enum (3): `CLOSED`, `OPEN`, `HALF_OPEN` | |

## Response size

`GET /ai/metrics` renders one Prometheus sample line per distinct label
combination per metric. With every label above now bounded, the total
number of time series is bounded by:

```
routes (~35) × http_status buckets (~10) × methods (~4)   [REQUEST_COUNT/LATENCY]
  + a handful of fixed reason/kind/outcome/task_type/step_name/prefix/provider/state enums
```

This comes to a low four-figure number of series at steady state,
regardless of how many task/artifact/dead-letter-item ids the service has
ever created or how long it has been running — the previous design grew
without bound as ids accumulated.
`tests/test_metrics_cardinality.py::test_metrics_endpoint_response_size_is_bounded`
exercises a burst of requests against every id-bearing route and asserts
`/ai/metrics`'s response stays under **256 KB**, documenting the expected
scrape size so a regression here fails CI instead of surfacing as a slow
or dropped scrape in production.

## Adding a new metric

See the "Cardinality guidance" section at the top of
[`metrics.py`](./metrics.py). In short: if a label's value isn't one of a
small set fixed in code, bound it before it reaches `.labels()`, and add a
row to the table above.
