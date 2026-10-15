# Soter AI Service — Operations Playbook

This document records the operational knowledge around the AI service provider
layer, prompt construction, resilience mechanisms (circuit breakers, alerts,
cost ceilings, rate limiting tiers, load shedding), caching, and cost control.
It is intended for engineers who need to add providers, tune fallbacks, evolve
prompts, configure rate tiers and cost limits, or reason about cost and cache behaviour.

---

## 1. Adding and Configuring a New Provider — End-to-End

The AI service uses a uniform `ModelProvider` abstraction in
[providers.py](services/providers.py).
Two capabilities exist: `llm_chat` (LLM chat completion) and `ocr_extract`
(structured OCR from images). A provider may implement either or both.

### 1.1 Step 1 — Implement the provider class

Subclass `ModelProvider` (abstract base) in
[providers.py](services/providers.py#L70-L106).

**Required:**

- `name` property — unique lowercase identifier (e.g. `"anthropic"`). Must be
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
  any standard exception. Either is counted as a failure by the circuit
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

Edit [config.py](config.py):

1. Add an API-key field and a default model field to `Settings`:
   ```python
   anthropic_api_key: Optional[str] = None
   anthropic_model: str = "claude-3-haiku-20240307"
   ```
2. If the provider is a "real" (non-test, non-local) provider, include it in
   the production guard in `apply_environment_defaults` and in
   `validate_api_keys`. A typical pattern is to OR it into the existing
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
[humanitarian_verification.py](services/humanitarian_verification.py#L139-L146),
add a branch for the new provider name so `get_model_version()` can build the
correct cache tag. The tag must be stable across restarts — it keys the
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
[providers.py](services/providers.py#L406-L410),
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
[providers.py](services/providers.py#L421-L439)
so the new provider appears in the candidate list when its key is configured.
Order matters — it is the _default fallback order_ when `provider_preference`
is `"auto"`. Put cheaper / faster providers first, more expensive / slower
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
[schemas/humanitarian.py](schemas/humanitarian.py#L19-L21).
Append the new name so API clients can ask for it by name:

```python
provider_preference: Literal["auto", "test", "openai", "groq", "anthropic"] = "auto"
```

### 1.7 Step 7 — Cover with tests

Add tests that mirror the existing patterns in
[tests/test_providers.py](tests/test_providers.py):

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
operation in the dead-letter / admin API. Otherwise cached responses from
the old model continue to be served for up to `cache_ttl_verification`
seconds (default 120).

---

## 2. Fallback Selection, Circuit Breaking, and Load Shedding — Interactions

The three resilience mechanisms are layered. Understanding their order is
critical for debugging "why did request X go to provider Y?" or "why are we
returning 503 when we have capacity?".

### 2.1 Order of operations for a single request

For every incoming verification request (such as `POST /v1/ai/humanitarian/verify`),
the middleware layers and verification service execute in a strictly defined order.
The first layer that produces a response or rejects a request short-circuits the rest:

```
 Incoming Request
     │
     ▼
 [1] RequestSizeLimitMiddleware ──► HTTP 413 (REQUEST_BODY_TOO_LARGE)
     │   Checks Content-Length & streaming bytes against MAX_REQUEST_BODY_BYTES (10 MiB)
     │
     ▼
 [2] Per-Key Rate Limiter (RateLimiterService) ──► HTTP 429 (RATE_LIMIT_EXCEEDED)
     │   Sliding window per API key (or client IP fallback) against endpoint limit
     │
     ▼
 [3] Per-Organization Rate Limiter (OrganizationRateLimiterService) ──► HTTP 429 (ORGANIZATION_RATE_LIMIT_EXCEEDED)
     │   Maps API key to Org ID; checks shared sliding window against org tier
     │
     ▼
 [4] Load Shedding Middleware (evaluate_load_shed) ──► HTTP 503 (Retry-After: 30)
     │   Checks RAM/VRAM memory threshold, Celery queue depth, and provider circuit state
     │
     ▼
 [5] Artifact Access Control ──► HTTP 400 / 403
     │   Validates cryptographic signature / ownership if artifact_ids are attached
     │
     ▼
 [6] Verification Response Cache Lookup ──► HTTP 200 (Cache HIT)
     │   Returns cached verification verdict if identical inputs/artifacts hit Redis
     │
     ▼
 [7] HumanitarianVerificationService.verify_claim
     │   For each candidate (provider_name, provider) in order:
     │     ┌─ [7a] Provider Cost Ceiling Check (is_exceeded)
     │     │      BREACHED ───────────────► route to fallback_provider;
     │     │                                if no fallback, route to manual_review
     │     │
     │     ├─ [7b] CircuitBreaker.allow_request()
     │     │      OPEN ───────────────────► skip to next provider
     │     │      HALF_OPEN / CLOSED ────► proceed to execution
     │     │
     │     ├─ [7c] Try PRIMARY prompt variant
     │     │      success ───────────────► record_success(), record token usage & spend, return
     │     │      failure ───────────────► record_failure(), attempt fallback prompt
     │     │
     │     └─ [7d] Try FALLBACK prompt variant (same provider)
     │            success ───────────────► record_success(), record token usage & spend, return
     │            failure ───────────────► record_failure() (trips breaker if threshold met),
     │                                     advance to next provider in fallback chain
     │
     ▼
 [8] All Providers Exhausted or Circuits Open
     │   Gracefully returns verdict: "inconclusive", manual_review: true, reason: "provider_outage"
     │
     ▼
 [9] Background Webhook Alerting (CircuitBreakerAlerts)
         Fires asynchronous, HMAC-signed JSON alert on OPEN or CLOSED transitions
```

### 2.2 Provider fallback selection semantics

`ProviderRegistry.resolve_llm(preference)` in
[providers.py](services/providers.py)
builds the ordered candidate list used by step 7.

Rules:

- `"test"` preference, when test mode is enabled, returns `[("test", ...)]`
  exclusively. Test provider is never subject to API key checks.
- Any other concrete preference name (e.g. `"groq"`) is placed FIRST in the
  list, followed by every other available provider in their configured
  fallback order (`LLM_PROVIDER_FALLBACK_ORDER`). The requested preference always gets
  the first attempt, even if cheaper providers exist.
- `"auto"` (default) returns providers in the order declared by
  `LLM_PROVIDER_FALLBACK_ORDER` (default: `openai,groq,test`), filtered by providers
  whose API keys are actually configured and active.
- Only providers whose configuration gate is true are included. No key = not
  in the list. This is how ops gracefully "turn off" a provider without a
  deploy: remove or blank its env var and it vanishes from consideration on
  the next process restart.

**Within a single provider**, the service always tries the PRIMARY prompt
first, then the FALLBACK prompt, before moving to the next provider. In
other words: the fallback prompt is intra-provider, not cross-provider. This
means a 429 or a timeout on the primary prompt on provider A will record a
circuit-breaker failure, try the (cheaper / simpler) fallback prompt against
provider A, record another failure if that also fails, and _then_ try
provider B. Consequence: a bad provider can accumulate 2 circuit-breaker
failures per verification attempt — so the default threshold of 3 failures
trips the breaker after just 2 _or_ 3 consecutive bad requests depending on
how many prompt variants actually ran.

### 2.3 Circuit breaker — state machine and administrative controls

Each provider gets its own `CircuitBreaker` instance, created lazily the
first time a verification references the provider. The implementation is in
[circuit_breaker.py](services/circuit_breaker.py).
Configuration comes from [config.py](config.py).

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

- `failure_threshold` (default 3, env: `CIRCUIT_BREAKER_FAILURE_THRESHOLD`) — number of recorded
  failures to trip CLOSED → OPEN. Note failures from BOTH prompt variants count toward this,
  so a provider that fails both variants per request can trip the breaker in
  2 requests (4 failures would exceed threshold=3).
- `recovery_timeout_seconds` (default 30, env: `CIRCUIT_BREAKER_RECOVERY_TIMEOUT_SECONDS`) — minimum
  time spent in OPEN before a probe is allowed. Transition to HALF_OPEN occurs on the next
  `allow_request()` call _after_ the timeout has elapsed; the state machine does not run a
  background polling loop.
- Thread safety: all state mutations are performed under a single `Lock` per `CircuitBreaker`.

**Success / failure recording boundary** — in
[humanitarian_verification.py](services/humanitarian_verification.py),
`breaker.record_success()` is called as soon as `provider.llm_chat()` returns
and `_parse_json_response()` parses without throwing. Any transport exception, HTTP timeout,
or JSON parse exception goes to `breaker.record_failure()`. Note: expected domain errors
(e.g., `MalformedProviderOutputError` or `ProviderRefusalError` where the model answered
with an explicit refusal) do not trip the breaker.

#### Administrative Controls and Manual Reset

Operators can inspect breaker states and force a reset back to `CLOSED` via dedicated admin
routes in [services/admin_circuit_breaker_routes.py](services/admin_circuit_breaker_routes.py).
All admin endpoints require an `X-Admin-Token` header:

- **GET `/admin/circuit-breakers`**: Returns a JSON dictionary of all registered breakers and their states:
  ```json
  {
    "openai": {
      "provider": "openai",
      "state": "OPEN",
      "failure_count": 3,
      "time_until_retry": 18.4
    },
    "groq": {
      "provider": "groq",
      "state": "CLOSED",
      "failure_count": 0,
      "time_until_retry": 0.0
    }
  }
  ```
- **GET `/admin/circuit-breakers/{provider}`**: Returns the current state dictionary for a single provider.
  Returns HTTP 404 if the provider is unknown.
- **POST `/admin/circuit-breakers/{provider}/reset`**: Immediately forces the provider breaker back to
  `CLOSED`, clears `failure_count` to 0, and emits an asynchronous `recovered` webhook alert.
  Accepts an optional JSON body: `{"reason": "manual_operator_intervention"}`.

Example manual reset using curl:

```bash
curl -X POST "http://localhost:8000/admin/circuit-breakers/openai/reset" \
  -H "X-Admin-Token: $AI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "upstream_outage_resolved"}'
```

---

### 2.4 Circuit breaker alerting

While the admin API allows querying and resetting circuit breaker states, operators need immediate
push notifications when a breaker trips. The alerting subsystem in
[services/circuit_breaker_alerts.py](services/circuit_breaker_alerts.py)
bridges this gap by delivering signed webhook notifications on actionable transitions.

#### Actionable Triggers

Alerts are fired exclusively on transitions that require operator visibility or action:

| Event       | Transition           | Operational Meaning                                                                                                              |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `opened`    | any state → `OPEN`   | A provider has exceeded its failure threshold and is now short-circuiting calls. Traffic is falling back to secondary providers. |
| `recovered` | any state → `CLOSED` | A half-open probe succeeded, or an operator manually reset the breaker. The provider has resumed normal serving.                 |

> [!NOTE]
> Probes (`CLOSED → HALF_OPEN`) are deliberately **not** alerted. Probes represent automated internal
> health checks; alerting on them would create unnecessary noise during intermittent recovery cycles.

#### Webhook Contract and HMAC Signing

The alert payload is serialized as camelCase JSON conforming to Schema Version `1.0`:

```json
{
  "alertType": "circuit_breaker",
  "event": "opened",
  "provider": "openai",
  "fromState": "CLOSED",
  "toState": "OPEN",
  "failureCount": 3,
  "reason": "failure_threshold_reached:3/3",
  "timestamp": "2026-10-15T12:00:00Z",
  "service": "soter-ai-service",
  "schemaVersion": "1.0"
}
```

When `AI_WEBHOOK_SECRET` is configured, every outbound alert includes an HMAC-SHA256 signature in
the `X-Signature-256` header:

```
X-Signature-256: <lowercase hex HMAC-SHA256 of the raw JSON body>
```

Receivers must verify this signature using constant-time comparison before parsing the payload.

#### De-duplication and Flapping Protection

A provider that flaps rapidly between `OPEN` and `CLOSED` must not flood operator notification
channels. Alerts are de-duplicated by `(provider, event)` within a configurable time window:

- `CIRCUIT_BREAKER_ALERT_DEDUP_SECONDS` (default: `300.0` seconds / 5 minutes). Set to `0` to disable.
- Because de-duplication is tracked _per event_, the initial `opened` alert and subsequent `recovered`
  alert are both delivered even if recovery happens within seconds. Only duplicate events of the
  _same type_ for the _same provider_ inside the window are suppressed.
- Suppressed alerts are logged at `INFO` level as `circuit_breaker_alert_suppressed` and counted
  in Prometheus metrics.

#### Asynchronous Non-Blocking Delivery and Failure Modes

- **Asynchronous Execution:** Webhook delivery executes on a short-lived background daemon thread.
  It never blocks, adds latency to, or fails the user request that triggered the circuit transition.
- **Fail-Safe Operation:** If the alert sink is offline, returns a 4xx/5xx status, or times out
  (10s timeout), the error is logged as `circuit_breaker_alert_delivery_failed` and recorded in
  metrics. It is never raised.
- **Retry Preservation:** Failed deliveries do _not_ record a timestamp in the de-duplication table.
  This ensures that if the webhook receiver was temporarily unreachable, the next state transition
  will attempt immediate delivery rather than being suppressed.

---

### 2.5 Provider cost ceiling with automatic fallback

Verification requests consume LLM tokens with real monetary costs. The provider cost ceiling
subsystem in [services/provider_cost_ceiling.py](services/provider_cost_ceiling.py)
enforces proactive, windowed spend caps per provider, preventing runaway costs before circuit
breakers are ever tripped.

#### Configuration and Startup Validation

Cost ceilings are configured via environment variables in [config.py](config.py):

```bash
# JSON object specifying per-provider ceilings
LLM_PROVIDER_COST_CEILINGS='{
  "openai": {
    "limit_usd": 50.0,
    "window": "daily",
    "fallback_provider": "groq"
  },
  "groq": {
    "limit_usd": 20.0,
    "window": "daily",
    "fallback_provider": null
  }
}'

# Token pricing rates per 1,000 tokens (USD)
LLM_MODEL_COST_PER_1K_TOKENS='{
  "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
  "llama-3.3-70b-versatile": {"prompt": 0.000059, "completion": 0.000079}
}'
```

`Settings.validate_configuration()` enforces strict rules at boot:

1. `window` must be `"hourly"` (3,600s) or `"daily"` (86,400s).
2. Every provider declared in `LLM_PROVIDER_COST_CEILINGS` must have corresponding model token
   rates configured in `LLM_MODEL_COST_PER_1K_TOKENS`.
3. If a `fallback_provider` is declared, its configured model token rates must be strictly cheaper
   than the parent provider's rates. A provider cannot fall back to itself or to a more expensive provider.

#### Spend Tracking and Redis Window Buckets

- Spend is tracked in UTC-aligned window buckets:
  - Hourly bucket: `bucket_number = int(utc_timestamp) // 3600`
  - Daily bucket: `bucket_number = int(utc_timestamp) // 86400`
  - Redis key format: `ai:provider-cost:{provider}:{window}:{bucket_number}`
- After each successful LLM call, token usage (`prompt_tokens`, `completion_tokens`) is recorded,
  multiplied by model rates via `metrics.estimate_llm_cost_usd()`, and added to the Redis bucket via
  `INCRBYFLOAT`. The key TTL is automatically set to the end of the window.
- In test environments without Redis, a thread-safe in-memory dictionary provides local spend tracking.

#### Fallback and Manual Review Routing

When a verification request evaluates a provider:

1. **Ceiling Check:** The service calls `cost_ceiling.is_exceeded(provider_name)`.
2. **Ceiling Breached:**
   - Counter `llm_provider_cost_ceiling_exceeded_total{provider=provider_name}` increments.
   - If a `fallback_provider` is configured, the candidate queue is re-ordered to place the fallback
     provider at the head of the queue.
3. **No Fallback Available / Fallback Exhausted:**
   - If no fallback provider is configured, or if the fallback provider is also unavailable (circuit
     OPEN or its own ceiling breached), the claim is **not** aborted with a 500 error.
   - Instead, the claim is routed gracefully to **manual review**:
     ```json
     {
       "provider": null,
       "model": null,
       "verification": {
         "verdict": "inconclusive",
         "confidence": 0.0,
         "needs_review": true,
         "reason": "Provider cost ceiling reached; manual review required."
       },
       "manual_review": true,
       "reason": "provider_cost_ceiling"
     }
     ```
   - This ensures continuous, audit-safe platform operation under financial constraints.

---

### 2.6 Per-organization rate limit tiers

To prevent organizations from circumventing per-key rate limits by distributing traffic across
multiple API keys, the AI service provides independent organization-level rate limiting in
[services/org_rate_limiter.py](services/org_rate_limiter.py).

#### Architecture and Key Concepts

- **Per-Key Rate Limits:** Enforce independent limits per individual API key (e.g. `60/minute`).
- **Per-Organization Tiers:** Enforce a shared aggregate ceiling across _all_ keys owned by an
  organization (e.g., Acme Corp holds 5 keys, but the entire org is capped at `150/minute`).
- **Key-to-Org Mapping:** `ApiKeyOrgMapping` maintains the relationship between API keys and
  organization IDs.
- **Sliding Window Enforcement:** Uses a sliding window algorithm implemented via Redis sorted sets
  (`ratelimit:org:{org_id}`) with an automatic fallback to an in-memory deque.

#### Configuration

```bash
# Enable or disable organization rate limiting globally
ORG_RATE_LIMIT_ENABLED=true

# Organization tier ceilings (org_id -> limit/window)
ORG_RATE_LIMIT_TIERS='{
  "org-redcross": "200/minute",
  "org-field-ops": "100/minute",
  "org-pilot": "30/minute"
}'

# API key to organization mappings (api_key -> org_id)
API_KEY_TO_ORG_MAPPING='{
  "soter_key_rc_hq": "org-redcross",
  "soter_key_rc_mobile_1": "org-redcross",
  "soter_key_rc_mobile_2": "org-redcross",
  "soter_key_field_alpha": "org-field-ops"
}'
```

#### Middleware Pipeline and Distinct Error Response

`evaluate_org_rate_limit(request)` runs in `monitor_requests` immediately **after** the per-key
check passes and **before** load shedding.

When an organization's aggregate limit is exceeded, the service returns HTTP 429 with a distinct
error payload and headers, allowing clients to distinguish org-level budget exhaustion from key-level throttling:

```json
{
  "error": {
    "code": "ORGANIZATION_RATE_LIMIT_EXCEEDED",
    "message": "Organization rate limit exceeded. Please retry after the specified duration.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "retry_after": 14,
      "reset_seconds": 14,
      "window_seconds": 60,
      "organization_id": "org-field-ops",
      "limit_type": "organization"
    }
  }
}
```

Response Headers:

- `X-RateLimit-LimitType: organization` (absent on per-key 429s)
- `Retry-After: 14`
- `X-RateLimit-Limit: 100`
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: 14`

#### Adoption and Bypass Rules

1. **Unmapped Keys:** API keys not present in `API_KEY_TO_ORG_MAPPING` bypass org-level limiting
   entirely. They are governed solely by standard per-key rate limits.
2. **Unconfigured Orgs:** If an organization ID is not configured in `ORG_RATE_LIMIT_TIERS`, requests
   from that organization bypass org-level limiting.
3. This allows zero-downtime, gradual onboarding of organizations onto shared rate tiers.

---

### 2.7 Combined incident runbook: worked example

In real-world production emergencies, failures rarely occur in isolation. This worked example illustrates
how **circuit breakers**, **cost ceilings**, **alerts**, and **organization rate limits** interact
during a cascading multi-fault event.

#### Scenario Setup

- **Organization:** `org-disaster-relief` has 3 active API keys:
  - `key-hq`, `key-field-scan`, `key-drone-eval`
  - Per-key limit: `60/minute` each
  - Organization Tier ceiling: `120/minute` aggregate across all 3 keys
- **Providers:**
  - Primary: `openai` (`gpt-4o-mini`, $50 daily ceiling, configured fallback: `groq`)
  - Secondary: `groq` (`llama-3.3-70b-versatile`, $10 daily ceiling, no fallback)
- **Circuit Breaker:** `failure_threshold = 3`, `recovery_timeout = 30s`
- **Alerts:** `CIRCUIT_BREAKER_ALERT_WEBHOOK_URL` active with 300s dedup window.

```
       [Client Keys: key-hq, key-field-scan, key-drone-eval]
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │ [2] Per-Key Rate Limit (60/min per key)      │ ──► OK (< 60/min each)
        └──────────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │ [3] Org Rate Limit Tier (120/min aggregate)  │ ──► TRIP on retry storm!
        └──────────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │ [7a] Cost Ceiling Check                      │
        │   - openai: $4.50 / $50.00 (OK)              │
        │   - groq:  $10.02 / $10.00 (EXCEEDED) ───────┼──► Fallback to manual review!
        └──────────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │ [7b] Circuit Breaker Check                   │
        │   - openai: OPEN (3 consecutive timeouts) ───┼──► Emits 'opened' Webhook Alert!
        └──────────────────────────────────────────────┘
```

#### Incident Timeline & System Actions

1. **T0 — Primary Provider Outage:**
   - OpenAI experiences an upstream API degradation; requests begin timing out after 30 seconds.
   - Verification attempts fail primary prompt and fallback prompt.
   - The third consecutive failure hits `failure_threshold=3`.
   - `openai` breaker transitions `CLOSED → OPEN`.

2. **T+1s — Circuit Breaker Alert Emitted:**
   - `notify_breaker_transition()` fires in a background daemon thread.
   - Sends HTTP POST to `CIRCUIT_BREAKER_ALERT_WEBHOOK_URL` with header `X-Signature-256`:
     ```json
     {
       "alertType": "circuit_breaker",
       "event": "opened",
       "provider": "openai",
       "fromState": "CLOSED",
       "toState": "OPEN",
       "failureCount": 3,
       "reason": "failure_threshold_reached:3/3",
       "timestamp": "2026-10-15T14:22:01Z"
     }
     ```
   - On-call operator receives an urgent alert in PagerDuty / Slack.

3. **T+2s — Automatic Failover to Groq:**
   - Subsequent inbound claims arrive. Step [7b] checks `openai` breaker: `allow_request()` is `False`.
   - Verification automatically advances to secondary provider `groq`.
   - Groq calls succeed; claims continue processing without user-visible errors.

4. **T+20m — Traffic Surge & Fallback Cost Ceiling Breach:**
   - Heavy field ingestion channels 100% of platform verification volume into `groq`.
   - Redis daily bucket `ai:provider-cost:groq:daily:<bucket>` accumulates token spend rapidly.
   - Total spend crosses the $10.00 threshold ($10.02 recorded).
   - Step [7a] evaluates `cost_ceiling.is_exceeded("groq")`: returns `True`.
   - Metric `llm_provider_cost_ceiling_exceeded_total{provider="groq"}` increments.
   - Verification checks `fallback_provider` for `groq`: `None` configured.
   - **System Action:** Rather than failing with a 500 error, verification safely returns:
     ```json
     {
       "provider": null,
       "model": null,
       "verification": {
         "verdict": "inconclusive",
         "confidence": 0.0,
         "needs_review": true,
         "reason": "Provider cost ceiling reached; manual review required."
       },
       "manual_review": true,
       "reason": "provider_cost_ceiling"
     }
     ```

5. **T+25m — Client Automated Retry Storm:**
   - Field ingestion clients receive `"verdict": "inconclusive"` and trigger automated retry loops.
   - `key-hq` sends 50 req/min; `key-field-scan` sends 50 req/min; `key-drone-eval` sends 40 req/min.
   - **Per-Key Evaluation (Step [2]):** Each key is below its individual 60/min limit. All per-key checks pass!
   - **Org Tier Evaluation (Step [3]):** Combined rate = 140 req/min. Organization ceiling is 120 req/min.
   - **System Action:** `OrganizationRateLimiterService` intercepts the 121st request and returns HTTP 429:
     ```json
     {
       "error": {
         "code": "ORGANIZATION_RATE_LIMIT_EXCEEDED",
         "details": {
           "organization_id": "org-disaster-relief",
           "retry_after": 15,
           "limit_type": "organization"
         }
       }
     }
     ```
   - The AI service memory, network, and database queues are protected from collapse.

6. **T+30m — Operator Triage and Resolution:**
   - Operator investigates the `opened` alert and checks `/ai/metrics`:
     - Sees `llm_provider_current_spend_usd{provider="groq"} = 10.02`
     - Sees `organization_rate_limit_exceeded_total` incrementing
   - Operator checks OpenAI status page: upstream outage is reported resolved.
   - Operator resets the OpenAI breaker using the admin API:
     ```bash
     curl -X POST http://localhost:8000/admin/circuit-breakers/openai/reset \
       -H "X-Admin-Token: $AI_ADMIN_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"reason": "openai_upstream_recovered"}'
     ```
   - Breaker transitions `OPEN → CLOSED`.
   - Alert subsystem immediately delivers a signed `recovered` notification:
     ```json
     {
       "alertType": "circuit_breaker",
       "event": "recovered",
       "provider": "openai",
       "fromState": "OPEN",
       "toState": "CLOSED",
       "failureCount": 0,
       "reason": "openai_upstream_recovered"
     }
     ```
   - Primary traffic resumes flowing to `openai`.
   - Client exponential backoffs engage; aggregate org request rate drops back under 120 req/min.
   - Normal automated verification is restored with zero data loss.

---

### 2.8 Load shedding and the `provider_down` signal

Load shedding is evaluated in the HTTP middleware before any service code
runs. See `evaluate_load_shed` in
[load_shedder.py](services/load_shedder.py).

Three independent checks; first match wins:

| Check         | Triggers when                                                                 | Routes affected                             | HTTP |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ---- |
| memory        | RAM or VRAM % > `load_shed_memory_threshold_percent` (default 90)             | ALL non-exempt routes                       | 503  |
| queue_full    | Celery `celery` queue len >= `load_shed_max_celery_queue_depth` (default 100) | POST /v1/ai/inference, POST /v1/ai/ocr/jobs | 503  |
| provider_down | `all_providers_unavailable() == True`                                         | POST /v1/ai/humanitarian/verify             | 503  |

`all_providers_unavailable()` (in
[humanitarian_verification.py](services/humanitarian_verification.py))
returns True only when _every_ name returned by `available_llm_providers()`
has a circuit breaker whose `allow_request()` is False. Because it calls
`allow_request()`, it has a side effect: if any OPEN circuit has aged past
`recovery_timeout_seconds`, the very act of checking transitions it to
HALF_OPEN and the check itself returns False for that provider. This is the
_intended_ recovery path — the shed response on /verify acts as a health
probe that quietly unblocks one circuit every 30 s. Consequence: after all
circuits trip, the very first `/verify` request at t+30s will NOT be shed —
it will go through to step 4 and act as the HALF_OPEN probe.

Exempt routes that never load-shed (hard-coded in `monitor_requests` in
[main.py](main.py)):
`/health`, `/`, `/ai/metrics`, `/docs`, `/redoc`, `/openapi.json`, plus any
route that is only a legacy → v1 redirect.

### 2.9 Dead-letter queue — what happens after retries run out

The DLQ captures items that failed terminally. Two entry points:

1. **Callback webhook delivery failures.** `tasks.send_webhook_notification`
   retries synchronously with backoff in a background thread; if the final
   attempt returns non-2xx the payload is enqueued with
   `dead_letter_queue.add(kind="callback", ...)`.
2. **Async Celery job retry exhaustion.** When `task_max_retries` (default 3) is reached, the task failure handler calls
   `tasks.handle_task_retries_exhausted` which adds `kind="async_job"`.

See [dead_letter.py](services/dead_letter.py)
and [tests/test_dead_letter.py](tests/test_dead_letter.py).

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
- `exhausted` — HTTP 409 with code `"exhausted"`. Bump attempt count in
  config and restart, or delete and re-add (requires code change; there is
  no public API for it yet).
- `rate_limited` — HTTP 429 with `Retry-After` header based on
  `dead_letter_replay_cooldown_seconds` (default 10 s).

All replay attempts (success or failure) are appended to the entry's
`audit_log` with actor, timestamp, and optional error text. DLQ items are
currently **in-memory only** — they do not survive an AI-service restart.
This matches the pattern used for task status in `tasks.py`. For a
production hardening story, back the store with Redis.

---

## 3. Prompt Change Process — Versioning and Evaluation

Prompts for humanitarian verification are built by `HumanitarianPromptEngine`
in
[humanitarian_prompt.py](services/humanitarian_prompt.py).
Two variants exist: `build_primary_prompt` (the detailed, expensive,
high-quality one) and `build_fallback_prompt` (compact, token-cheap,
strictly structured for robustness).

### 3.1 What a prompt change implies

A change to either prompt method can cause:

- **Different verdicts** on identical input — including "regression" on
  previously-credible claims.
- **Different token usage** — both input (system+user prompt bytes) and
  output (schema dictates response size). Token cost scales linearly with
  prompt length, so adding a Sphere section or a new required JSON field has
  measurable cost.
- **Different parse-failure rates.** `_parse_json_response` tolerates
  markdown fences, but a more permissive schema with optional free-text
  fields typically has higher variance and can raise more `RuntimeError`
  "LLM response must be a JSON object". Each parse failure counts as a
  circuit-breaker failure (see §2.3) and triggers the fallback prompt or
  the next provider.
- **Stale cache entries.** Prompt text is part of the hashed function args
  to `@cached_response`, so _identical request payloads_ still produce
  different cache keys after a prompt change. Old entries simply age out
  via TTL (default 120 s) — there is no explicit "prompt version" tag.

### 3.2 Prompt versioning and registry

Verification prompts are managed through `PromptRegistry` in `services/prompt_registry.py`
and declared in `services/humanitarian_prompt.py`.

Prompt versions are:

1. **Explicitly addressed by name and version**: e.g., `registry.get("humanitarian_primary", "v1")`.
2. **Immutable**: Registered prompt versions cannot be overwritten in place. Modifying a prompt requires creating and registering a new version (e.g., `v2`).
3. **Configurable**: The active version per prompt is configurable via environment variables (`HUMANITARIAN_PRIMARY_PROMPT_VERSION`, `HUMANITARIAN_FALLBACK_PROMPT_VERSION`) or dynamically via `registry.set_active_version(name, version)`.
4. **Recorded on every result**: Every verification result envelope includes `prompt_version`, and the result dictionary contains `prompt_name`, `prompt_version`, and `prompt_variant`.
5. **Keyed in response caching**: The cache key embeds `prompt_version` in `key_tags`, guaranteeing disjoint cache entries when active prompt versions change.

```python
from services.prompt_registry import VerificationPrompt, default_prompt_registry

class HumanitarianPrimaryPromptV3(VerificationPrompt):
    name = "humanitarian_primary"
    version = "v3"

    def build_prompt(self, aid_claim, supporting_evidence, context_factors):
        ...
        return {"system": system_prompt, "user": user_prompt}

# Register new version
default_prompt_registry.register(HumanitarianPrimaryPromptV3(), set_active=True)
```

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
  `recommended_next_steps[]`. No `criteria_assessment` — callers must
  tolerate its absence when `prompt_variant == "fallback"`.
- `verdict` values are used by the NestJS backend in release-config logic;
  adding new values requires a coordinated backend change.

**Step 2 — Update `SPHERE_HANDBOOK_CRITERIA` or prompt methods.**
Keep the structure consistent: the primary prompt uses Sphere sections as
bullet lists, and the engine `_format_*` helpers are the only thing that
turns structured data into prompt text.

**Step 3 — Add / update the unit tests in `test_humanitarian_prompt.py`.**
The existing tests assert key substrings are present. For every new
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
in `regression_harness/` targets OCR only). For prompt changes, the
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
     win. Consider keeping the fallback prompt extra-tight so the average
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
change automatically. But if you also changed the configured model (e.g.
`OPENAI_MODEL`), call the invalidation helper for the old
`(provider, old_model)` pair to avoid serving stale outputs during the TTL
window.

---

## 4. Caching and Invalidation Behaviour

The AI service exposes a Redis-backed response cache via
[cache.py](services/cache.py).
It is fail-soft: if Redis cannot be reached at startup, the cache logs a
warning and runs with `enabled=False`; every read returns None and every
write is a no-op. The same applies for any mid-run Redis error — failures
are logged and the underlying function executes transparently.

### 4.1 What is cached, and what is NOT

Currently cached endpoints via `@cached_response`:

| Prefix                      | TTL (s) default | key_tags                                                                        | Source file / call site                                  |
| --------------------------- | --------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `task_status`               | 30              | —                                                                               | cache_decorator pattern; used in tasks/status paths      |
| `artifact_access`           | 60              | —                                                                               | evidence/artifact access wrappers                        |
| `humanitarian_verification` | 120             | `model_version`, `artifact_tag` (plus a secondary key embedding `content_hash`) | [api/v1/humanitarian.py](api/v1/humanitarian.py#L28-L32) |

What is intentionally **NOT cached**:

- **Proof-of-life analysis** — biometric data must not be retained, and the
  result depends on high-entropy per-frame state.
- **PII scrubbing / anonymization** — input text may contain PII; caching
  it would exfiltrate sensitive content into Redis. (If caching is ever
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
[cache.py](services/cache.py#L48-L93)
builds keys in two layers:

```
cache:ai:<prefix>[:<name>=<sanitized_value> ...]:<sha256_of_args_and_kwargs>
```

- `<sha256_of_args_and_kwargs>` — deterministic JSON-serialised hash of
  _all_ positional + keyword arguments (kwargs sorted alphabetically). Any
  change in inputs (including the prompt text constants embedded via the
  service call) produces a different hash. This layer provides correctness
  and collision safety.
- `<name>=<sanitized_value>` segments (0 or more) come from `key_tags` on
  the decorator. Values are sanitised with
  `_sanitize_tag_value` which replaces `*?[]:` with `_` so glob patterns
  can target them. This layer enables **pattern-based invalidation** — the
  entire raison d'être of key_tags.

For `humanitarian_verification`, `model_version` is resolved at request
time via `humanitarian_verification_service.get_model_version(preference)`
(format: `"<provider>:<model>"` → sanitised to
`"<provider>_<model>"`). `artifact_tag` is `",".join(sorted(artifact_ids))`
or `""` when absent. If either tag is `""`/`None` it is omitted from the
key (see `_generate_key` — tags with empty values are filtered).

**Content-hash secondary keying** (`cached_response(..., content_hash_arg=...)`):

- In addition to the artifact-keyed entry, a second entry is written whose
  key embeds `content_hash=<sha256>` and **omits** `artifact_tag`
  (`content_key_exclude_tags=("artifact_tag",)`). Both entries share the
  same `humanitarian_verification` prefix, so model/prompt/global
  invalidation patterns match both.
- The content hash is SHA-256 over the length-prefixed raw bytes of the
  evidence artifacts sorted by artifact id (see `_compute_evidence_content_hash`
  in [api/v1/humanitarian.py](api/v1/humanitarian.py)).
  Identical bytes re-uploaded under a new artifact id therefore collide on
  the same content key, so a repeated-verification request returns the
  cached result without a new provider call.
- On a content-key hit the primary artifact key is backfilled; single-flight
  coalescing is keyed on the content hash when present so concurrent
  identical-content requests share one computation.

### 4.3 Safe vs. unsafe caching rules

**Safe to cache:**

- Deterministic function of its inputs. Same args → same result within TTL.
- Output is not secret/PII, or the caller has already redacted it.
- The cost of computing the function significantly exceeds the cost of a
  Redis round-trip (≈1 ms for a local Redis; humanitarian LLM calls are in
  the 500 ms–5 s range, so the break-even is ~3 requests after a cache
  miss).
- A stale result within the TTL window is acceptable. For verification,
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
[cache_invalidation.py](services/cache_invalidation.py).
Each method uses `delete_pattern()` which calls `SCAN` (non-blocking,
O(N) in key count) and then issues one bulk `DEL` for matching keys.

| Scenario                                   | Method                                                      | Redis match pattern                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task status changed externally             | `invalidate_task_status(task_id)`                           | `cache:ai:task_status:*<task_id>*`                                                                                                                                                                               |
| Artifact metadata update                   | `invalidate_artifact_access(artifact_id)`                   | `cache:ai:artifact_access:*<artifact_id>*`                                                                                                                                                                       |
| Evidence artifact was re-uploaded / edited | `invalidate_verification_by_artifact(artifact_id)`          | `cache:ai:humanitarian_verification:*artifact_tag=*<artifact_id>*` **plus** `cache:ai:humanitarian_verification:*content_hash=*` (the old content hash is unknowable, so the whole content namespace is cleared) |
| Configured model for a provider changed    | `invalidate_verification_by_model_version(provider, model)` | `cache:ai:humanitarian_verification:*model_version=<sanitized(provider:model)>*`                                                                                                                                 |
| Deploy with breaking prompt / major change | `invalidate_all()`                                          | `cache:ai:*` (nuclear — only use during maintenance windows)                                                                                                                                                     |

All invalidations increment `CACHE_INVALIDATION_TOTAL{reason="<reason>"}` —
a Prometheus Counter exported from [metrics.py](metrics.py).
The counter has no label cardinality cap because the reason set is small
and static.

### 4.5 How cache, fallback, and circuit breaker interact

A cache HIT bypasses all downstream resilience machinery:
`HumanitarianVerificationService` is never invoked; no circuit breaker is
consulted; no provider call is made. This is the primary cost-saving
path — see §5.

A cache MISS flows through the full chain of §2.1. Crucially, if the
primary provider times out (recorded as a breaker failure) but the fallback
prompt on the SAME provider succeeds, the cached entry records
`prompt_variant="fallback"` and the _first-available provider_ in its
provider+model tag. Future cache hits on the same input keep serving the
fallback-prompt result for 120 s. If you want the primary-prompt quality
for that request after the transient clears, either wait for TTL expiry or
invalidate by model_version (both variants share the same tag, so both are
dropped).

---

## 5. Cost Drivers and Control Levers

Every provider call has a direct monetary cost (API pricing) plus an
indirect operational cost (latency, queue pressure, engineering time spent
debugging failures). This section enumerates what drives cost and the
levers available to control them — without changing code where possible.

### 5.1 Cost drivers ranked by magnitude

1. **Number of LLM provider calls per verification request.**
   In the worst case a single request can call:
   `(number of available providers) × (2 prompt variants)` times.
   With two providers this is up to 4x the base call cost. Every circuit
   breaker trip or fallback activation increases this multiplier.
   Cache HITs bring the multiplier to 0.

2. **Input token volume (system + user prompt).**
   - Primary prompt is roughly 2–3 × larger than fallback because it
     includes the full Sphere handbook criteria listing and a more detailed
     schema description. Token count scales linearly with number of
     `SPHERE_HANDBOOK_CRITERIA` entries, number of supporting_evidence
     items, and the size of context_factors.
   - Evidence is user-supplied and unbounded; a single entry can be
     thousands of characters. Adding a size limit in the schema (or
     truncating with a clear "… [truncated]" marker) caps worst-case spend.

3. **Output token volume.**
   Dictated by the schema requested. `criteria_assessment[]` in the
   primary prompt generates ~5 structured objects (one per Sphere section)
   — ~100–300 extra output tokens per call. The fallback prompt omits
   this section; its responses are ~40-80 tokens.

4. **Model choice.**
   Defaults today: `gpt-4o-mini` (OpenAI) and
   `llama-3.3-70b-versatile` (Groq). Model pricing is typically per 1M
   input/output tokens and varies by 1–2 orders of magnitude between
   model families. `settings.openai_model` / `settings.groq_model` are
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
[config.py](config.py) and
[.env.example](.env.example)).

| Lever                                 | Env var                                                                        | Effect on cost                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Disable expensive providers           | Unset `OPENAI_API_KEY` / `GROQ_API_KEY`                                        | Removes provider from `available_llm_providers()`. Fewer candidates = cheaper worst-case fallback. |
| Prefer a cheaper provider per request | `provider_preference="<name>"` in API body                                     | Per-request override. Preferred provider is tried 1st; fallback chain still works.                 |
| Tune default order                    | Reorder in `available_llm_providers()`                                         | Put cheaper/faster first. Order is the default when clients use `"auto"`.                          |
| Use fixture/test provider in staging  | `TEST_PROVIDER_MODE=true`                                                      | Zero API cost; results from `fixtures/`. Never set this in production unless cost >> accuracy.     |
| Use deterministic mode for tests/CI   | `AI_DETERMINISTIC_MODE=true`                                                   | Bypasses the HTTP call for OpenAI/Groq providers entirely.                                         |
| Shorter TTL for verification cache    | `CACHE_TTL_VERIFICATION=60` (was 120)                                          | Reduces cost of serving stale after model upgrades (but reduces HIT rate slightly).                |
| Longer TTL for verification cache     | `CACHE_TTL_VERIFICATION=600`                                                   | Higher cache HIT rate → fewer provider calls. Risk: staler results; use with invalidation.         |
| Throttle verification endpoints       | `REQUEST_RATE_LIMIT` (20/min in production)                                    | Caps total provider spend per IP / rate-limit key.                                                 |
| More aggressive circuit breaker       | `CIRCUIT_BREAKER_FAILURE_THRESHOLD=2`                                          | Stops hammering a failing provider sooner. Saves cost of doomed primary+fallback calls.            |
| Longer circuit breaker recovery       | `CIRCUIT_BREAKER_RECOVERY_TIMEOUT_SECONDS=60`                                  | Reduces HALF_OPEN probe frequency — each probe is a real API call.                                 |
| Load shed earlier on memory / queue   | Lower `LOAD_SHED_MEMORY_THRESHOLD_PERCENT`, `LOAD_SHED_MAX_CELERY_QUEUE_DEPTH` | Avoids overloading → timeouts → fallbacks → multiplied token spend.                                |
| Smaller LLM timeout                   | `LLM_TIMEOUT_SECONDS=15`                                                       | Faster fail → fewer concurrent pending requests → less 429 cascading.                              |

### 5.3 Code-level levers (use after env-var tuning)

1. **Truncate evidence / context in the prompt.**
   Today `_format_evidence` and `_format_context_factors` blindly append
   all entries. A per-field cap (max 5 evidence items, max 1000 chars
   each) with an explicit `"Evidence truncated to N items"` note in the
   system prompt is a predictable cost win. Do not silently drop data —
   the LLM must know information was elided.

2. **Split Sphere criteria per-sector.**
   `SPHERE_HANDBOOK_CRITERIA` currently embeds all 5 sectors in every
   call. If a claim is known to be about only one sector (via
   `context_factors["sector"]`), `build_primary_prompt` could include
   only that sector plus a compact reference to the others. Expected
   token saving: ~50-60% on single-sector claims. Requires schema and
   consumer changes because `criteria_assessment` would have fewer
   entries.

3. **Model-tier routing by confidence fallback.**
   Today the same model is tried for both prompt variants. A cost-saving
   strategy: run primary prompt against a cheaper small model; if
   confidence < threshold, run it again (or just the hard cases) against
   the big model. Net cost ≈ `hit_rate * cheap_model + (1-hit_rate) *
(cheap_model + expensive_model)`. Only worth it if the cheap model
   has acceptably high precision on easy cases.

4. **Request coalescing / per-input deduplication.**
   The SHA-256 cache key effectively already does this across 120 s
   windows. For a workload with tight re-read patterns (same claim
   verified many times in a session), extend the TTL and add an in-memory
   L1 layer on top of Redis to shave the network hop.

### 5.4 Cost observability — metrics to track

Current Prometheus metrics in
[metrics.py](metrics.py)
don't include a direct per-token or per-dollar counter. To close the
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

| Concern                                     | File (clickable)                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Provider interface + registry               | [providers.py](services/providers.py)                                              |
| Verification service (fallback + CB wiring) | [humanitarian_verification.py](services/humanitarian_verification.py)              |
| Prompt engine                               | [humanitarian_prompt.py](services/humanitarian_prompt.py)                          |
| Circuit breaker                             | [circuit_breaker.py](services/circuit_breaker.py)                                  |
| Circuit breaker alerts                      | [circuit_breaker_alerts.py](services/circuit_breaker_alerts.py)                    |
| Provider cost ceiling                       | [provider_cost_ceiling.py](services/provider_cost_ceiling.py)                      |
| Per-org rate limiter                        | [org_rate_limiter.py](services/org_rate_limiter.py)                                |
| Admin circuit breaker API                   | [admin_circuit_breaker_routes.py](services/admin_circuit_breaker_routes.py)        |
| Load shedding                               | [load_shedder.py](services/load_shedder.py)                                        |
| Cache service + decorator                   | [cache.py](services/cache.py)                                                      |
| Cache invalidation helper                   | [cache_invalidation.py](services/cache_invalidation.py)                            |
| Dead-letter queue                           | [dead_letter.py](services/dead_letter.py)                                          |
| Settings / env config                       | [config.py](config.py)                                                             |
| Env var template                            | [.env.example](.env.example)                                                       |
| Verification endpoint (cache wiring + tags) | [api/v1/humanitarian.py](api/v1/humanitarian.py)                                   |
| Request schema (preference enum)            | [schemas/humanitarian.py](schemas/humanitarian.py)                                 |
| Middleware (shed order)                     | [main.py](main.py) (see `monitor_requests`)                                        |
| Custom exceptions                           | [exceptions.py](exceptions.py)                                                     |
| Prometheus metrics                          | [metrics.py](metrics.py)                                                           |
| Provider tests                              | [tests/test_providers.py](tests/test_providers.py)                                 |
| Prompt tests                                | [tests/test_humanitarian_prompt.py](tests/test_humanitarian_prompt.py)             |
| Circuit breaker tests                       | [tests/test_circuit_breaker.py](tests/test_circuit_breaker.py)                     |
| Circuit breaker alert tests                 | [tests/test_circuit_breaker_alerts.py](tests/test_circuit_breaker_alerts.py)       |
| Cost ceiling tests                          | [tests/test_provider_cost_ceiling.py](tests/test_provider_cost_ceiling.py)         |
| Org rate limiter tests                      | [tests/test_org_rate_limiter.py](tests/test_org_rate_limiter.py)                   |
| Load shedder tests                          | [tests/test_load_shedder.py](tests/test_load_shedder.py)                           |
| Cache service tests                         | [tests/test_cache_service.py](tests/test_cache_service.py)                         |
| Cache invalidation tests                    | [tests/test_cache_invalidation.py](tests/test_cache_invalidation.py)               |
| Dead-letter tests                           | [tests/test_dead_letter.py](tests/test_dead_letter.py)                             |
| Verification service tests                  | [tests/test_humanitarian_verification.py](tests/test_humanitarian_verification.py) |
| Test provider (fixtures)                    | [services/test_provider.py](services/test_provider.py)                             |
| OCR regression harness                      | [regression_harness/cli.py](regression_harness/cli.py)                             |
