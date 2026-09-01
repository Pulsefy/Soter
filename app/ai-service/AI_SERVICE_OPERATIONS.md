# Soter AI Service — Operations Playbook

This document records the operational knowledge around the AI service provider
layer, prompt construction, resilience mechanisms, caching, and cost control.
It is intended for engineers who need to add providers, tune fallbacks, evolve
prompts, or reason about cost and cache behaviour.

---

## 1. Adding and Configuring a New Provider — End-to-End

The AI service uses a uniform `ModelProvider` abstraction in
[providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py).
Two capabilities exist: `llm_chat` (LLM chat completion) and `ocr_extract`
(structured OCR from images).  A provider may implement either or both.

### 1.1 Step 1 — Implement the provider class

Subclass `ModelProvider` (abstract base) in
[providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py#L70-L106).

**Required:**

- `name` property — unique lowercase identifier (e.g. `"anthropic"`).  Must be
  stable because it is used as a preference string, a circuit-breaker key, and
  in the `provider` field of response payloads.
- One or both capability methods:
  - `llm_chat(system_prompt, user_prompt, *, model=None, timeout=None) -> LLMResponse`
  - `ocr_extract(image, *, language_hint=None) -> OCRResponse`

**Contract rules:**

- Unsupported capabilities MUST raise `NotImplementedError` (the base-class
  default already does this; only override capabilities you support).
- On a transient or downstream failure, raise either `AIServiceError` (with a
  `code` like `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, or `AI_CONNECTION_ERROR`) or
  any standard exception.  Either is counted as a failure by the circuit
  breaker and triggers the fallback chain.
- The returned `LLMResponse.provider` and `OCRResponse.provider` strings must
  match the `name` property (verification code and cache tags rely on this).

Example skeleton:

```python
class AnthropicProvider(ModelProvider):
    @property
    def name(self) -> str:
        return "anthropic"

    def llm_chat(self, system_prompt, user_prompt, *, model=None, timeout=None):
        if not settings.anthropic_api_key:
            raise RuntimeError("Anthropic API key is not configured")
        resolved_model = model or settings.anthropic_model
        # ... make HTTP call, wrap errors as AIServiceError ...
        return LLMResponse(content=..., provider="anthropic", model=resolved_model, latency_ms=...)
```

### 1.2 Step 2 — Add configuration to Settings

Edit [config.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/config.py):

1. Add an API-key field and a default model field to `Settings`:
   ```python
   anthropic_api_key: Optional[str] = None
   anthropic_model: str = "claude-3-haiku-20240307"
   ```
2. If the provider is a "real" (non-test, non-local) provider, include it in
   the production guard in `apply_environment_defaults` and in
   `validate_api_keys`.  A typical pattern is to OR it into the existing
   chain:
   ```python
   if self.app_env == "production":
       if not (self.openai_api_key or self.groq_api_key
               or self.anthropic_api_key or self.test_provider_mode):
           raise ValueError("Production requires at least one API key or TEST_PROVIDER_MODE=true")
   ```
3. Update `.env.example` (and the docstring on `Settings`) with the new env
   var names.

### 1.3 Step 3 — Wire the model resolver

In `HumanitarianVerificationService._get_model_for_provider` in
[humanitarian_verification.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_verification.py#L139-L146),
add a branch for the new provider name so `get_model_version()` can build the
correct cache tag.  The tag must be stable across restarts — it keys the
verification cache.

```python
def _get_model_for_provider(self, provider: str) -> str:
    if provider == "test":
        return "test-provider/fixture"
    if provider == "openai":
        return settings.openai_model
    if provider == "groq":
        return settings.groq_model
    if provider == "anthropic":           # <-- new
        return settings.anthropic_model  # <-- new
    raise ValueError(f"Unsupported provider: {provider}")
```

### 1.4 Step 4 — Register in the default ProviderRegistry

In `ProviderRegistry._register_default_providers` in
[providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py#L406-L410),
instantiate and register:

```python
def _register_default_providers(self) -> None:
    self.register(OpenAIProvider())
    self.register(GroqProvider())
    self.register(FixtureProvider())
    self.register(TesseractOCRProvider())
    self.register(AnthropicProvider())  # <-- new
```

### 1.5 Step 5 — Make it discoverable by `available_*_providers`

Update `ProviderRegistry.available_llm_providers` and/or
`available_ocr_providers` in
[providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py#L421-L439)
so the new provider appears in the candidate list when its key is configured.
Order matters — it is the *default fallback order* when `provider_preference`
is `"auto"`.  Put cheaper / faster providers first, more expensive / slower
providers later.

```python
def available_llm_providers(self) -> List[str]:
    available: List[str] = []
    if settings.test_provider_mode:
        available.append("test")
    if settings.openai_api_key:
        available.append("openai")
    if settings.groq_api_key:
        available.append("groq")
    if settings.anthropic_api_key:        # <-- new
        available.append("anthropic")     # <-- new
    return available
```

### 1.6 Step 6 — Expose it as a valid `provider_preference` value

The request schema `HumanitarianVerificationRequest.provider_preference` is a
`Literal` enum in
[schemas/humanitarian.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/schemas/humanitarian.py#L19-L21).
Append the new name so API clients can ask for it by name:

```python
provider_preference: Literal["auto", "test", "openai", "groq", "anthropic"] = "auto"
```

### 1.7 Step 7 — Cover with tests

Add tests that mirror the existing patterns in
[tests/test_providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_providers.py):

- `test_name` — check the `name` property is correct.
- `test_llm_chat_no_key_raises` — confirm guard when the API key is unset.
- `test_llm_chat_success` — mock `httpx.Client` and verify a 200 response is
  parsed into an `LLMResponse` with the correct `.provider`/`.model`.
- `ProviderRegistry` tests — confirm `available_llm_providers()` includes the
  new name when the key is set, and `resolve_llm()` puts it in the expected
  position with `"auto"` and with the provider set as preference.

Run:
```
cd app/ai-service ; python -m pytest tests/test_providers.py -xvs
```

### 1.8 Step 8 — Invalidate stale cache entries after a model upgrade

When you later change `settings.anthropic_model` (e.g. from `claude-3-haiku`
to `claude-3.5-haiku`), call
`CacheInvalidationHelper.invalidate_verification_by_model_version("anthropic",
"claude-3-haiku-20240307")` — either via a one-off script or by exposing the
operation in the dead-letter / admin API.  Otherwise cached responses from
the old model continue to be served for up to `cache_ttl_verification`
seconds (default 120).

---

## 2. Fallback Selection, Circuit Breaking, and Load Shedding — Interactions

The three resilience mechanisms are layered.  Understanding their order is
critical for debugging "why did request X go to provider Y?" or "why are we
returning 503 when we have capacity?".

### 2.1 Order of operations for a single request

For every `POST /v1/ai/humanitarian/verify` the middleware + service execute
in this order.  The first layer that produces a response (or an error) short
circuits the rest.

```
 Request
    │
    ▼
 [1] Load shed middleware  ──► 503 with Retry-After: 30
    │  - memory pressure? (RAM or VRAM > load_shed_memory_threshold_percent)
    │  - provider pressure? (ALL configured LLM circuits OPEN AND route is /verify)
    │  (queue pressure is skipped for /verify — checked only on async job routes)
    │
    ▼
 [2] Artifact access control  ──► 400/403 if evidence ownership checks fail
    │  (only when request carries artifact_ids)
    │
    ▼
 [3] Cache lookup  ──► Return cached result on HIT
    │
    ▼
 [4] HumanitarianVerificationService.verify_claim
    │    For each (provider_name, provider) in registry.resolve_llm(preference):
    │      ┌─ [4a] CircuitBreaker.allow_request()
    │      │    OPEN  ─────────────────► skip to next provider
    │      │    HALF_OPEN / CLOSED ───► continue
    │      │
    │      ├─ [4b] Try PRIMARY prompt variant
    │      │    success ──────────────► return result, record_success()
    │      │    failure ──────────────► record_failure(), try fallback prompt
    │      │
    │      └─ [4c] Try FALLBACK prompt variant (same provider)
    │           success ──────────────► return result, record_success()
    │           failure ──────────────► record_failure(), advance to next provider
    │
    ▼
 [5] All providers + prompts exhausted ──► RuntimeError -> HTTP 500 envelope
```

### 2.2 Provider fallback selection semantics

`ProviderRegistry.resolve_llm(preference)` in
[providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py#L441-L451)
builds the ordered candidate list used by step 4.

Rules:

- `"test"` preference, when test mode is enabled, returns `[("test", ...)]`
  exclusively.  Test provider is never subject to API key checks.
- Any other concrete preference name (e.g. `"groq"`) is placed FIRST in the
  list, followed by every other available provider in their default
  `available_llm_providers()` order.  The requested preference always gets
  the first attempt, even if cheaper providers exist.
- `"auto"` (default) returns providers in the order declared by
  `available_llm_providers()`, which currently is:
  `test → openai → groq` (when enabled/keyed).  Order in
  `available_llm_providers()` is the primary cost / quality lever — change it
  deliberately.
- Only providers whose configuration gate is true are included.  No key = not
  in the list.  This is how ops gracefully "turn off" a provider without a
  deploy: remove or blank its env var and it vanishes from consideration on
  the next process restart.

**Within a single provider**, the service always tries the PRIMARY prompt
first, then the FALLBACK prompt, before moving to the next provider.  In
other words: the fallback prompt is intra-provider, not cross-provider.  This
means a 429 or a timeout on the primary prompt on provider A will record a
circuit-breaker failure, try the (cheaper / simpler) fallback prompt against
provider A, record another failure if that also fails, and *then* try
provider B.  Consequence: a bad provider can accumulate 2 circuit-breaker
failures per verification attempt — so the default threshold of 3 failures
trips the breaker after just 2 *or* 3 consecutive bad requests depending on
how many prompt variants actually ran.

### 2.3 Circuit breaker — state machine

Each provider gets its own `CircuitBreaker` instance, created lazily the
first time a verification references the provider.  The implementation is in
[circuit_breaker.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/circuit_breaker.py).
Configuration comes from [config.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/config.py#L52-L53).

```
              failure_count < threshold
          ┌──────────────────────────────────┐
          │  (success resets failure_count)   │
          ▼                                   │
       ┌────────┐   fail>=threshold    ┌──────┐
       │ CLOSED │ ───────────────────► │ OPEN │
       └────────┘                      └──────┘
          ▲                               │
          │ success on probe              │ recovery_timeout elapsed
          │ (failure_count reset)         │ + next allow_request() check
          │                               ▼
          │                           ┌───────────┐
          └────────────────────────── │ HALF_OPEN │
            success on probe request  └───────────┘
                                         │ any failure
                                         └──────────────► OPEN (immediately)
```

Key parameters:
- `failure_threshold` (default 3) — number of recorded failures to trip
  CLOSED → OPEN.  Note failures from BOTH prompt variants count toward this,
  so a provider that fails both variants per request can trip the breaker in
  2 requests (4 failures would exceed threshold=3).
- `recovery_timeout_seconds` (default 30) — minimum time spent in OPEN before
  a probe is allowed.  Transition to HALF_OPEN only occurs on the next
  `allow_request()` call *after* the timeout has elapsed; the state machine
  does not have a background thread.
- Thread safety: all state mutations are performed under a single `Lock` per
  `CircuitBreaker`.

**Success / failure recording boundary** — in
[humanitarian_verification.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_verification.py#L66-L115),
`breaker.record_success()` is called as soon as `provider.llm_chat()` returns
and `_parse_json_response()` parses without throwing.  Any exception from
either the provider call or JSON parsing goes to `breaker.record_failure()`.
So *parseable-but-wrong* verdicts are NOT considered failures — only total
breakage of the provider/contract counts.

### 2.4 Load shedding and the `provider_down` signal

Load shedding is evaluated in the HTTP middleware before any service code
runs.  See `evaluate_load_shed` in
[load_shedder.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/load_shedder.py#L141-L167).

Three independent checks; first match wins:

| Check         | Triggers when                                                                 | Routes affected                                  | HTTP |
|---------------|-------------------------------------------------------------------------------|--------------------------------------------------|------|
| memory        | RAM or VRAM % > `load_shed_memory_threshold_percent` (default 90)            | ALL non-exempt routes                            | 503  |
| queue_full    | Celery `celery` queue len >= `load_shed_max_celery_queue_depth` (default 100)| POST /v1/ai/inference, POST /v1/ai/ocr/jobs     | 503  |
| provider_down | `all_providers_unavailable() == True`                                        | POST /v1/ai/humanitarian/verify                  | 503  |

`all_providers_unavailable()` (in
[humanitarian_verification.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_verification.py#L120-L129))
returns True only when *every* name returned by `available_llm_providers()`
has a circuit breaker whose `allow_request()` is False.  Because it calls
`allow_request()`, it has a side effect: if any OPEN circuit has aged past
`recovery_timeout_seconds`, the very act of checking transitions it to
HALF_OPEN and the check itself returns False for that provider.  This is the
*intended* recovery path — the shed response on /verify acts as a health
probe that quietly unblocks one circuit every 30 s.  Consequence: after all
circuits trip, the very first `/verify` request at t+30s will NOT be shed —
it will go through to step 4 and act as the HALF_OPEN probe.

Exempt routes that never load-shed (hard-coded in `monitor_requests` in
[main.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/main.py#L392-L447)):
`/health`, `/`, `/ai/metrics`, `/docs`, `/redoc`, `/openapi.json`, plus any
route that is only a legacy → v1 redirect.

### 2.5 Dead-letter queue — what happens after retries run out

The DLQ captures items that failed terminally.  Two entry points:

1. **Callback webhook delivery failures.**  `tasks.send_webhook_notification`
   retries synchronously with backoff in a background thread; if the final
   attempt returns non-2xx the payload is enqueued with
   `dead_letter_queue.add(kind="callback", ...)`.
2. **Async Celery job retry exhaustion.**  When `task_max_retries` (default
   3) is reached, the task failure handler calls
   `tasks.handle_task_retries_exhausted` which adds `kind="async_job"`.

See [dead_letter.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/dead_letter.py)
and [tests/test_dead_letter.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_dead_letter.py).

Replay lifecycle per entry:

```
 pending ──replay──► succeeded (terminal; cannot replay again)
    │               exhausted (terminal; max_attempts reached)
    │               pending + incremented attempts (cooldown enforced)
    │
    └─ add() is idempotent per (kind, task_id); re-adding same failed item
       updates error/payload/status but does not reset attempt count.
```

Replay guards (`check_replayable`):
- `not_found` — entry unknown.
- `already_succeeded` — 200 response with `"status": "succeeded"`; calling
  the replay API returns a 200 but the item is not re-executed.
- `exhausted` — HTTP 409 with code `"exhausted"`.  Bump attempt count in
  config and restart, or delete and re-add (requires code change; there is
  no public API for it yet).
- `rate_limited` — HTTP 429 with `Retry-After` header based on
  `dead_letter_replay_cooldown_seconds` (default 10 s).

All replay attempts (success or failure) are appended to the entry's
`audit_log` with actor, timestamp, and optional error text.  DLQ items are
currently **in-memory only** — they do not survive an AI-service restart.
This matches the pattern used for task status in `tasks.py`.  For a
production hardening story, back the store with Redis.

---

## 3. Prompt Change Process — Versioning and Evaluation

Prompts for humanitarian verification are built by `HumanitarianPromptEngine`
in
[humanitarian_prompt.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_prompt.py).
Two variants exist: `build_primary_prompt` (the detailed, expensive,
high-quality one) and `build_fallback_prompt` (compact, token-cheap,
strictly structured for robustness).

### 3.1 What a prompt change implies

A change to either prompt method can cause:

- **Different verdicts** on identical input — including "regression" on
  previously-credible claims.
- **Different token usage** — both input (system+user prompt bytes) and
  output (schema dictates response size).  Token cost scales linearly with
  prompt length, so adding a Sphere section or a new required JSON field has
  measurable cost.
- **Different parse-failure rates.**  `_parse_json_response` tolerates
  markdown fences, but a more permissive schema with optional free-text
  fields typically has higher variance and can raise more `RuntimeError`
  "LLM response must be a JSON object".  Each parse failure counts as a
  circuit-breaker failure (see §2.3) and triggers the fallback prompt or
  the next provider.
- **Stale cache entries.**  Prompt text is part of the hashed function args
  to `@cached_response`, so *identical request payloads* still produce
  different cache keys after a prompt change.  Old entries simply age out
  via TTL (default 120 s) — there is no explicit "prompt version" tag.

### 3.2 Prompt versioning

The engine currently has **no explicit prompt_version string**.  Versioning
is implicit in:

1. **Git history** of `humanitarian_prompt.py` — each release commit is a
   version.
2. **The `model_version` cache tag** (format `<provider>:<model>`) — because
   the decorator also hashes all function args, and the prompt text is
   compiled from static constants at class definition time, two builds with
   different prompt sources produce disjoint cache keys *for the same
   `model_version`*.  This is safe but not observable at runtime — there is
   no way to tell "this cached response came from prompt v2" without
   cross-referencing the deploy SHA.

If you need explicit, runtime-observable versioning (recommended for any
regression harness work), add a class constant or property:

```python
class HumanitarianPromptEngine:
    PROMPT_VERSION = "v3"  # bump on any change to build_* or SPHERE_*
```

and include it in either (a) the cache key via `key_tags`, or (b) a field in
the returned `verification` dict so downstream evaluators can segment
results.

### 3.3 Change process — recommended steps

**Step 1 — Understand the invariants.**
The following are relied upon by callers and must be preserved unless the
consumers are updated in lock-step:

- `build_primary_prompt` output JSON schema must require at minimum
  `verdict`, `confidence`, `summary`, `criteria_assessment[]`,
  `risk_flags[]`, `missing_information[]`, `recommended_next_steps[]`.
  `verdict` enum is `credible | partially_credible | inconclusive | not_credible`.
  `confidence` must be a float in `[0.0, 1.0]`.
- `build_fallback_prompt` output schema is a strict subset: `verdict`,
  `confidence`, `summary`, `risk_flags[]`, `missing_information[]`,
  `recommended_next_steps[]`.  No `criteria_assessment` — callers must
  tolerate its absence when `prompt_variant == "fallback"`.
- `verdict` values are used by the NestJS backend in release-config logic;
  adding new values requires a coordinated backend change.

**Step 2 — Update `SPHERE_HANDBOOK_CRITERIA` or prompt methods.**
Keep the structure consistent: the primary prompt uses Sphere sections as
bullet lists, and the engine `_format_*` helpers are the only thing that
turns structured data into prompt text.

**Step 3 — Add / update the unit tests in `test_humanitarian_prompt.py`.**
The existing tests assert key substrings are present.  For every new
invariant you introduce (e.g. "water section must always mention hygiene"),
add a corresponding `assert "... ..." in prompt["user"]` line so the prompt
cannot be accidentally regressed by a future refactor.

```bash
cd app/ai-service ; python -m pytest tests/test_humanitarian_prompt.py -xvs
```

**Step 4 — Run the deterministic + provider tests.**
The test suite uses `ai_deterministic_mode=True` and `test_provider_mode` in
various combinations — both must still pass:

```bash
cd app/ai-service ; python -m pytest tests/test_humanitarian_verification.py tests/test_providers.py tests/test_test_provider_stability.py -xvs
```

**Step 5 — Evaluate against the regression harness (OCR) or build a prompt
eval dataset (LLM).**

For LLM prompts there is currently no built-in regression harness (the one
in `regression_harness/` targets OCR only).  For prompt changes, the
recommended manual evaluation is:

1. Build a dataset of `N >= 20` real-world-like `{aid_claim,
   supporting_evidence[], context_factors{}}` items with known expected
   verdicts.
2. Run both old and new prompt against the same provider + model with
   caching disabled (or different `model_version`/tags) and record:
   - verdict agreement rate (%)
   - confidence distribution shift (mean, stdev)
   - average input+output tokens per call (approximated by char count in
     `system_prompt + user_prompt + response.content`)
   - parse failure count (lower is better; zero failures = strict schema
     adherence)
   - criteria_assessment completion rate in primary prompt
3. Decide the trade-off:
   - **Verdict drift > 10-15%** on real data is a red flag — the prompt
     change is too disruptive; narrow the scope.
   - **Token increase > 20%** must be justified by a measurable accuracy
     win.  Consider keeping the fallback prompt extra-tight so the average
     cost under fallback stays small.
   - **New parse failures** → adjust schema instructions or return stricter
     format enforcement; the prompt says "Return valid JSON only" for a
     reason.

**Step 6 — Deploy and monitor.**
Key Prometheus metrics to watch after a prompt deploy:
- `api_request_count{endpoint="/v1/ai/humanitarian/verify", http_status=~"5.."}`
  — if 5xx spikes, more prompts are failing JSON parsing or more providers
  are timing out due to larger prompts.
- `pipeline_step_latency_seconds{step_name="verify"}` — prompt size affects
  provider latency directly.
- `requests_shed_total{reason="provider_down"}` — a prompt change that
  increases parse failures can trip circuit breakers faster and push the
  service into 503s.

**Step 7 — Invalidate related caches (if necessary).**
A pure prompt change doesn't need explicit invalidation — the hash inputs
change automatically.  But if you also changed the configured model (e.g.
`OPENAI_MODEL`), call the invalidation helper for the old
`(provider, old_model)` pair to avoid serving stale outputs during the TTL
window.

---

## 4. Caching and Invalidation Behaviour

The AI service exposes a Redis-backed response cache via
[cache.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/cache.py).
It is fail-soft: if Redis cannot be reached at startup, the cache logs a
warning and runs with `enabled=False`; every read returns None and every
write is a no-op.  The same applies for any mid-run Redis error — failures
are logged and the underlying function executes transparently.

### 4.1 What is cached, and what is NOT

Currently cached endpoints via `@cached_response`:

| Prefix                        | TTL (s) default | key_tags                     | Source file / call site                             |
|-------------------------------|-----------------|------------------------------|-----------------------------------------------------|
| `task_status`                 | 30              | —                            | cache_decorator pattern; used in tasks/status paths |
| `artifact_access`             | 60              | —                            | evidence/artifact access wrappers                   |
| `humanitarian_verification`   | 120             | `model_version`, `artifact_tag` | [api/v1/humanitarian.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/api/v1/humanitarian.py#L28-L32) |

What is intentionally **NOT cached**:

- **Proof-of-life analysis** — biometric data must not be retained, and the
  result depends on high-entropy per-frame state.
- **PII scrubbing / anonymization** — input text may contain PII; caching
  it would exfiltrate sensitive content into Redis.  (If caching is ever
  added, scrub BEFORE hashing and document the data-classification guard.)
- **OCR extraction** — image bytes are large; hashing them is expensive and
  storing raw text responses would require a separate classification
  review.
- **Any async job submission** — `POST /v1/ai/inference` and
  `/v1/ai/ocr/jobs` create Celery tasks; they are rate-limited via load
  shedding but not cached.
- **Dead-letter API** — `list`, `get`, `replay` are always live.

### 4.2 Key construction and the role of `key_tags`

`CacheService._generate_key` in
[cache.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/cache.py#L48-L93)
builds keys in two layers:

```
cache:ai:<prefix>[:<name>=<sanitized_value> ...]:<sha256_of_args_and_kwargs>
```

- `<sha256_of_args_and_kwargs>` — deterministic JSON-serialised hash of
  *all* positional + keyword arguments (kwargs sorted alphabetically).  Any
  change in inputs (including the prompt text constants embedded via the
  service call) produces a different hash.  This layer provides correctness
  and collision safety.
- `<name>=<sanitized_value>` segments (0 or more) come from `key_tags` on
  the decorator.  Values are sanitised with
  `_sanitize_tag_value` which replaces `*?[]:` with `_` so glob patterns
  can target them.  This layer enables **pattern-based invalidation** — the
  entire raison d'être of key_tags.

For `humanitarian_verification`, `model_version` is resolved at request
time via `humanitarian_verification_service.get_model_version(preference)`
(format: `"<provider>:<model>"` → sanitised to
`"<provider>_<model>"`).  `artifact_tag` is `",".join(sorted(artifact_ids))`
or `""` when absent.  If either tag is `""`/`None` it is omitted from the
key (see `_generate_key` — tags with empty values are filtered).

### 4.3 Safe vs. unsafe caching rules

**Safe to cache:**

- Deterministic function of its inputs.  Same args → same result within TTL.
- Output is not secret/PII, or the caller has already redacted it.
- The cost of computing the function significantly exceeds the cost of a
  Redis round-trip (≈1 ms for a local Redis; humanitarian LLM calls are in
  the 500 ms–5 s range, so the break-even is ~3 requests after a cache
  miss).
- A stale result within the TTL window is acceptable.  For verification,
  120 s of staleness is fine because evidence artifacts are versioned and
  the cache is invalidated when artifacts are updated.

**Unsafe to cache (do NOT add `@cached_response` without first reviewing):**

- Functions whose return value depends on non-input state: wall-clock time,
  randomness, per-session context, external feature flags.
- Functions that accept or return PII/PHI without explicit redaction.
  Redis is not an encrypted store by default.
- Functions that write side effects (DB calls, enqueue work, send emails).
  Caching them would replay the side effect on hit.
- Functions whose failure modes should be observed by monitoring — caching
  would mask the underlying error rate.

### 4.4 Invalidation patterns

All invalidation is mediated by `CacheInvalidationHelper` in
[cache_invalidation.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/cache_invalidation.py).
Each method uses `delete_pattern()` which calls `SCAN` (non-blocking,
O(N) in key count) and then issues one bulk `DEL` for matching keys.

| Scenario                                   | Method                                                        | Redis match pattern                                                                        |
|--------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Task status changed externally             | `invalidate_task_status(task_id)`                             | `cache:ai:task_status:*<task_id>*`                                                         |
| Artifact metadata update                   | `invalidate_artifact_access(artifact_id)`                     | `cache:ai:artifact_access:*<artifact_id>*`                                                 |
| Evidence artifact was re-uploaded / edited | `invalidate_verification_by_artifact(artifact_id)`            | `cache:ai:humanitarian_verification:*artifact_tag=*<artifact_id>*`                         |
| Configured model for a provider changed    | `invalidate_verification_by_model_version(provider, model)`   | `cache:ai:humanitarian_verification:*model_version=<sanitized(provider:model)>*`           |
| Deploy with breaking prompt / major change | `invalidate_all()`                                            | `cache:ai:*`  (nuclear — only use during maintenance windows)                               |

All invalidations increment `CACHE_INVALIDATION_TOTAL{reason="<reason>"}` —
a Prometheus Counter exported from [metrics.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/metrics.py).
The counter has no label cardinality cap because the reason set is small
and static.

### 4.5 How cache, fallback, and circuit breaker interact

A cache HIT bypasses all downstream resilience machinery:
`HumanitarianVerificationService` is never invoked; no circuit breaker is
consulted; no provider call is made.  This is the primary cost-saving
path — see §5.

A cache MISS flows through the full chain of §2.1.  Crucially, if the
primary provider times out (recorded as a breaker failure) but the fallback
prompt on the SAME provider succeeds, the cached entry records
`prompt_variant="fallback"` and the *first-available provider* in its
provider+model tag.  Future cache hits on the same input keep serving the
fallback-prompt result for 120 s.  If you want the primary-prompt quality
for that request after the transient clears, either wait for TTL expiry or
invalidate by model_version (both variants share the same tag, so both are
dropped).

---

## 5. Cost Drivers and Control Levers

Every provider call has a direct monetary cost (API pricing) plus an
indirect operational cost (latency, queue pressure, engineering time spent
debugging failures).  This section enumerates what drives cost and the
levers available to control them — without changing code where possible.

### 5.1 Cost drivers ranked by magnitude

1. **Number of LLM provider calls per verification request.**
   In the worst case a single request can call:
   `(number of available providers) × (2 prompt variants)` times.
   With two providers this is up to 4x the base call cost.  Every circuit
   breaker trip or fallback activation increases this multiplier.
   Cache HITs bring the multiplier to 0.

2. **Input token volume (system + user prompt).**
   - Primary prompt is roughly 2–3 × larger than fallback because it
     includes the full Sphere handbook criteria listing and a more detailed
     schema description.  Token count scales linearly with number of
     `SPHERE_HANDBOOK_CRITERIA` entries, number of supporting_evidence
     items, and the size of context_factors.
   - Evidence is user-supplied and unbounded; a single entry can be
     thousands of characters.  Adding a size limit in the schema (or
     truncating with a clear "… [truncated]" marker) caps worst-case spend.

3. **Output token volume.**
   Dictated by the schema requested.  `criteria_assessment[]` in the
   primary prompt generates ~5 structured objects (one per Sphere section)
   — ~100–300 extra output tokens per call.  The fallback prompt omits
   this section; its responses are ~40-80 tokens.

4. **Model choice.**
   Defaults today: `gpt-4o-mini` (OpenAI) and
   `llama-3.3-70b-versatile` (Groq).  Model pricing is typically per 1M
   input/output tokens and varies by 1–2 orders of magnitude between
   model families.  `settings.openai_model` / `settings.groq_model` are
   hot-swappable via env vars — a rolling restart is the only required
   step, but remember to call `invalidate_verification_by_model_version`
   afterwards so responses from the old model don't linger in cache.

5. **Timeout / retry amplification.**
   `llm_timeout_seconds` (default 30 s) is the per-call HTTP timeout.
   Higher values don't increase token cost directly, but they hold
   connections longer and increase concurrency pressure on the provider,
   which can trigger 429s and cause the fallback chain to spend more
   tokens overall.

### 5.2 Control levers — no code changes needed

Set via environment variables and `.env` (documented in
[config.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/config.py) and
[.env.example](file:///C:/Users/H/Desktop/Soter/app/ai-service/.env.example)).

| Lever                                    | Env var                                      | Effect on cost                                                                        |
|------------------------------------------|----------------------------------------------|---------------------------------------------------------------------------------------|
| Disable expensive providers              | Unset `OPENAI_API_KEY` / `GROQ_API_KEY`      | Removes provider from `available_llm_providers()`.  Fewer candidates = cheaper worst-case fallback. |
| Prefer a cheaper provider per request    | `provider_preference="<name>"` in API body   | Per-request override.  Preferred provider is tried 1st; fallback chain still works.  |
| Tune default order                       | Reorder in `available_llm_providers()`       | Put cheaper/faster first.  Order is the default when clients use `"auto"`.            |
| Use fixture/test provider in staging     | `TEST_PROVIDER_MODE=true`                    | Zero API cost; results from `fixtures/`.  Never set this in production unless cost >> accuracy. |
| Use deterministic mode for tests/CI      | `AI_DETERMINISTIC_MODE=true`                 | Bypasses the HTTP call for OpenAI/Groq providers entirely.                            |
| Shorter TTL for verification cache       | `CACHE_TTL_VERIFICATION=60` (was 120)        | Reduces cost of serving stale after model upgrades (but reduces HIT rate slightly).   |
| Longer TTL for verification cache        | `CACHE_TTL_VERIFICATION=600`                 | Higher cache HIT rate → fewer provider calls.  Risk: staler results; use with invalidation. |
| Throttle verification endpoints          | `REQUEST_RATE_LIMIT` (20/min in production)  | Caps total provider spend per IP / rate-limit key.                                    |
| More aggressive circuit breaker          | `CIRCUIT_BREAKER_FAILURE_THRESHOLD=2`        | Stops hammering a failing provider sooner.  Saves cost of doomed primary+fallback calls. |
| Longer circuit breaker recovery          | `CIRCUIT_BREAKER_RECOVERY_TIMEOUT_SECONDS=60`| Reduces HALF_OPEN probe frequency — each probe is a real API call.                     |
| Load shed earlier on memory / queue      | Lower `LOAD_SHED_MEMORY_THRESHOLD_PERCENT`, `LOAD_SHED_MAX_CELERY_QUEUE_DEPTH` | Avoids overloading → timeouts → fallbacks → multiplied token spend.                  |
| Smaller LLM timeout                      | `LLM_TIMEOUT_SECONDS=15`                     | Faster fail → fewer concurrent pending requests → less 429 cascading.                 |

### 5.3 Code-level levers (use after env-var tuning)

1. **Truncate evidence / context in the prompt.**
   Today `_format_evidence` and `_format_context_factors` blindly append
   all entries.  A per-field cap (max 5 evidence items, max 1000 chars
   each) with an explicit `"Evidence truncated to N items"` note in the
   system prompt is a predictable cost win.  Do not silently drop data —
   the LLM must know information was elided.

2. **Split Sphere criteria per-sector.**
   `SPHERE_HANDBOOK_CRITERIA` currently embeds all 5 sectors in every
   call.  If a claim is known to be about only one sector (via
   `context_factors["sector"]`), `build_primary_prompt` could include
   only that sector plus a compact reference to the others.  Expected
   token saving: ~50-60% on single-sector claims.  Requires schema and
   consumer changes because `criteria_assessment` would have fewer
   entries.

3. **Model-tier routing by confidence fallback.**
   Today the same model is tried for both prompt variants.  A cost-saving
   strategy: run primary prompt against a cheaper small model; if
   confidence < threshold, run it again (or just the hard cases) against
   the big model.  Net cost ≈ `hit_rate * cheap_model + (1-hit_rate) *
   (cheap_model + expensive_model)`.  Only worth it if the cheap model
   has acceptably high precision on easy cases.

4. **Request coalescing / per-input deduplication.**
   The SHA-256 cache key effectively already does this across 120 s
   windows.  For a workload with tight re-read patterns (same claim
   verified many times in a session), extend the TTL and add an in-memory
   L1 layer on top of Redis to shave the network hop.

### 5.4 Cost observability — metrics to track

Current Prometheus metrics in
[metrics.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/metrics.py)
don't include a direct per-token or per-dollar counter.  To close the
observability gap (recommended before any large-scale rollout), extend
`LLMResponse` to include `input_tokens` and `output_tokens` (OpenAI and
Groq both return `usage` in their response JSON) and emit:

- `llm_tokens_total{provider, model, direction, prompt_variant}` — Counter
- `llm_requests_total{provider, model, prompt_variant, result}` — Counter

With those two counters you can derive:
- Average tokens per request (by provider × prompt variant)
- Estimated spend (`sum(tokens) * $/token` per provider)
- Fallback prompt activation rate = `fallback_requests / total_requests`
  — high rate = primary prompt is failing often, which means cost is
  ~2× baseline and circuit breakers are at risk of tripping.

Without explicit token counters, the best proxies in the current system
are:
- `pipeline_step_latency_seconds{step_name="verify"}` — latency correlates
  loosely with prompt size and model tier.
- `requests_shed_total{reason="provider_down"}` — sudden rises = circuit
  breakers tripping across the board → high fallback-chain spend before
  shedding kicks in.
- 2xx rate on `/v1/ai/humanitarian/verify` — drops preceded by a prompt
  change indicate the new prompt is triggering more parse failures.

---

## Appendix A — File Reference Map

All code paths mentioned above, mapped to their absolute paths for quick
navigation.

| Concern                     | File (clickable)                                                                                                                   |
|-----------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Provider interface + registry | [providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/providers.py)                                             |
| Verification service (fallback + CB wiring) | [humanitarian_verification.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_verification.py)             |
| Prompt engine               | [humanitarian_prompt.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/humanitarian_prompt.py)                         |
| Circuit breaker             | [circuit_breaker.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/circuit_breaker.py)                                 |
| Load shedding               | [load_shedder.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/load_shedder.py)                                       |
| Cache service + decorator   | [cache.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/cache.py)                                                     |
| Cache invalidation helper   | [cache_invalidation.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/cache_invalidation.py)                           |
| Dead-letter queue           | [dead_letter.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/dead_letter.py)                                         |
| Settings / env config       | [config.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/config.py)                                                            |
| Env var template            | [.env.example](file:///C:/Users/H/Desktop/Soter/app/ai-service/.env.example)                                                      |
| Verification endpoint (cache wiring + tags) | [api/v1/humanitarian.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/api/v1/humanitarian.py)                                  |
| Request schema (preference enum) | [schemas/humanitarian.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/schemas/humanitarian.py)                               |
| Middleware (shed order)     | [main.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/main.py)  (see `monitor_requests`)                                      |
| Custom exceptions           | [exceptions.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/exceptions.py)                                                    |
| Prometheus metrics          | [metrics.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/metrics.py)                                                          |
| Provider tests              | [tests/test_providers.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_providers.py)                                |
| Prompt tests                | [tests/test_humanitarian_prompt.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_humanitarian_prompt.py)            |
| Circuit breaker tests       | [tests/test_circuit_breaker.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_circuit_breaker.py)                    |
| Load shedder tests          | [tests/test_load_shedder.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_load_shedder.py)                          |
| Cache service tests         | [tests/test_cache_service.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_cache_service.py)                        |
| Cache invalidation tests    | [tests/test_cache_invalidation.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_cache_invalidation.py)              |
| Dead-letter tests           | [tests/test_dead_letter.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_dead_letter.py)                            |
| Verification service tests  | [tests/test_humanitarian_verification.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/tests/test_humanitarian_verification.py)|
| Test provider (fixtures)    | [services/test_provider.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/services/test_provider.py)                            |
| OCR regression harness      | [regression_harness/cli.py](file:///C:/Users/H/Desktop/Soter/app/ai-service/regression_harness/cli.py)                            |
