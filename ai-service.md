# AI Service Issues

## Wave 8

Wave 8 AI service work concentrates on making inference results trustworthy and auditable,
hardening the request lifecycle, and closing validation gaps in the shared contract with the
backend. Wave 7 delivered the callback contract, dead-letter replay, upload session persistence,
async OCR jobs, cache invalidation, and priority queues; these issues extend that surface.

---

## Issue 1: Validate Anchor Metadata Identifier Fields
**Labels:** ai-service, security, api, data-model, integration
**Complexity:** Trivial (100)

**Description**
`AnchorMetadata` in `app/ai-service/schemas/common.py` declares `campaign_ref`, `claim_id`, and
`package_id` as plain `Optional[str]` with no length bound or character restriction. These values
are echoed into `ResultEnvelope` and flow through the backend toward onchain anchoring, so an
unbounded or control-character-bearing identifier propagates untouched into log lines, storage, and
correlation keys.

Add validation at the schema boundary, where every endpoint using the shared type benefits.

**Acceptance Criteria**
- All three identifier fields are validated against an explicit pattern and maximum length
- Validation failures return `422` with a message naming the offending field
- The constraint appears in the generated OpenAPI schema
- Empty strings are rejected while omitted (`None`) values remain valid
- Tests cover valid values, over-length values, and disallowed characters

---

## Issue 2: Version and Register Verification Prompts
**Labels:** ai-service, feature, versioning, architecture, audit
**Complexity:** Hard (200)

**Description**
`app/ai-service/services/humanitarian_prompt.py` builds prompts inline. Because prompts are not
versioned, a result cannot be traced to the exact prompt that produced it, and a prompt change
silently alters behaviour with no way to compare before and after.

Introduce a prompt registry with explicit versions recorded on every result.

**Acceptance Criteria**
- Prompts are addressed by name and version from a registry
- The prompt version used is recorded on the result envelope
- Changing a prompt requires a new version rather than editing in place
- The active version per prompt is configurable
- Tests assert the recorded version matches the prompt actually used

---

## Issue 3: Validate and Recover From Malformed Model Output
**Labels:** ai-service, reliability, bug, integration, testing
**Complexity:** Hard (200)

**Description**
`app/ai-service/services/humanitarian_verification.py` and `fraud_detection.py` parse provider
responses into typed results. When a provider returns prose, truncated JSON, or a refusal, the
failure surfaces as an opaque parse error rather than a structured, retryable outcome. This is the
most common real-world provider failure mode and is currently the least well handled.

**Acceptance Criteria**
- Provider output is validated against the expected schema before use
- Malformed output triggers a bounded retry with a repair or reformat attempt
- Persistent malformed output yields a typed error distinct from transport failure
- Provider refusals are detected and surfaced as their own outcome
- Tests cover truncated JSON, prose responses, and explicit refusals

---

## Issue 4: Account for Token Usage and Cost Per Request
**Labels:** ai-service, observability, metrics, ops, analytics
**Complexity:** Medium (150)

**Description**
`app/ai-service/services/providers.py` dispatches to multiple providers, but token consumption is
neither recorded nor exposed. There is no way to attribute spend to an endpoint, a provider, or a
campaign, which makes cost control and capacity planning guesswork.

**Acceptance Criteria**
- Prompt and completion token counts are captured per request where the provider reports them
- Usage is exposed as metrics labelled by provider, model, and endpoint
- Estimated cost is derivable from configurable per-model rates
- Requests where usage is unavailable are counted separately rather than as zero
- Metric label cardinality stays bounded

---

## Issue 5: Make Provider Fallback Order Explicit and Configurable
**Labels:** ai-service, reliability, config, integration, feature
**Complexity:** Medium (150)

**Description**
`providers.py` supports `auto`, `test`, `openai`, and `groq` selection, and `circuit_breaker.py`
guards failing providers, but the fallback order under `auto` is implicit in the code. Operators
cannot express a preference such as cheapest-first or lowest-latency-first without editing source.

**Acceptance Criteria**
- Fallback order is defined in configuration and validated at startup
- The provider that actually served a request is recorded on the result
- Providers with an open circuit are skipped rather than retried
- Exhausting all providers yields a distinct, documented error
- Tests cover ordering, skipping, and exhaustion

---

## Issue 6: Propagate Trace Identifiers Through Provider Calls and Callbacks
**Labels:** ai-service, observability, integration, devex, api
**Complexity:** Medium (150)

**Description**
`ResultEnvelope` carries a `trace_id` echoed from `X-Correlation-Id`, and the backend has
correlation utilities, but the identifier is not consistently attached to provider calls, cache
operations, async OCR jobs, or dead-letter records. Tracing a single verification across the
service is therefore not possible today.

**Acceptance Criteria**
- The trace identifier is bound to a request context available throughout the request
- Every log line emitted during a request includes it
- Async jobs and dead-letter records retain the originating identifier
- Outbound callbacks to the backend propagate it as a header
- Tests assert propagation through an async OCR job and a callback

---

## Issue 7: Route Low-Confidence OCR Results to Manual Review
**Labels:** ai-service, feature, workflow, evidence, integration
**Complexity:** Medium (150)

**Description**
`app/ai-service/services/ocr.py` and `ocr_job.py` return extracted text, but a low-confidence
extraction is returned exactly like a high-confidence one. The backend consequently treats
unreliable text as authoritative, and there is no signal that a human should look at the document.

**Acceptance Criteria**
- OCR results carry a confidence value and a banding derived from configurable thresholds
- Results below the threshold are flagged for review in the response
- The flag is included in the callback payload to the backend
- Thresholds are configurable per document type where available
- Tests cover above-threshold, below-threshold, and missing-confidence cases

---

## Issue 8: Build a Golden-Set Accuracy Harness for Humanitarian Verification
**Labels:** ai-service, testing, feature, devex, product
**Complexity:** Hard (200)

**Description**
`app/ai-service/regression_harness/` and `fixtures/` exercise the service, but there is no
labelled golden set measuring whether verification decisions are actually correct. Prompt and model
changes are therefore evaluated only for crashes, not for accuracy regressions.

**Acceptance Criteria**
- A committed labelled fixture set covers approve, reject, and ambiguous cases
- A runnable harness reports precision, recall, and per-case outcomes
- Baseline metrics are committed and compared against on each run
- The harness runs against the deterministic test provider without network access
- Adding new labelled cases is documented for contributors

---

## Issue 9: Drain In-Flight Work on Graceful Shutdown
**Labels:** ai-service, reliability, ops, infrastructure, bug
**Complexity:** Medium (150)

**Description**
`app/ai-service/main.py` and `tasks.py` accept requests and run background OCR jobs, but there is
no shutdown handling. On redeploy, in-flight requests are severed and queued jobs are lost without
reaching the dead-letter path, so a routine deployment silently drops work.

**Acceptance Criteria**
- Shutdown stops accepting new requests while completing in-flight ones within a timeout
- Background jobs are either completed or persisted for resumption
- Work that cannot be completed is written to the dead-letter store
- The drain timeout is configurable
- Readiness reports not-ready as soon as draining begins

---

## Issue 10: Validate Configuration at Startup
**Labels:** ai-service, config, reliability, devex, ops
**Complexity:** Trivial (100)

**Description**
`app/ai-service/config.py` reads environment configuration, but missing or malformed values
surface as runtime failures on the first request that needs them. A service with an invalid callback
secret or absent provider key starts successfully and then fails in production traffic.

**Acceptance Criteria**
- Required configuration is validated at startup and failure prevents serving
- The error names every invalid or missing key at once
- Optional values with defaults are reported at debug level on boot
- Secrets are never written to logs, consistent with `logging_redaction.py`
- Tests cover valid, missing, and malformed configuration

---

## Issue 11: Guard Prometheus Metric Label Cardinality
**Labels:** ai-service, observability, performance, metrics, reliability
**Complexity:** Medium (150)

**Description**
`app/ai-service/metrics.py` exposes Prometheus metrics. Several plausible label sources —
artifact id, claim id, model name, error string — are effectively unbounded, and unbounded labels
are the standard way a metrics endpoint degrades into an availability problem.

**Acceptance Criteria**
- An audit identifies every metric label and its cardinality bound
- Unbounded values are bucketed, hashed, or removed
- A test asserts label values come from a bounded set
- The `/metrics` scrape stays within a documented response size
- Guidance for adding new metrics is documented

---

## Issue 12: Test Multi-Tenant Isolation for Artifact Access
**Labels:** ai-service, security, testing, evidence, privacy
**Complexity:** Medium (150)

**Description**
`services/artifact_access.py` and `services/evidence_access_control.py` enforce evidence
ownership, and `EVIDENCE_OWNERSHIP_ENFORCEMENT.md` describes the intent. What is missing is an
adversarial test suite proving one organization cannot reach another's artifacts across every
endpoint that touches artifacts.

**Acceptance Criteria**
- Tests attempt cross-tenant access on every artifact-touching endpoint
- Both direct id access and indirect reference paths are covered
- Denials return a consistent status that does not leak existence
- Cache keys are asserted to include the tenant scope
- Any gap found is fixed or recorded as a follow-up issue

---

## Issue 13: Write a Structured Decision Audit Record for Every Verification
**Labels:** ai-service, audit, feature, governance, observability
**Complexity:** Hard (200)

**Description**
Verification and fraud endpoints return decisions that influence whether aid is disbursed, but
nothing durably records the inputs, provider, model, prompt version, and reasons behind a decision.
Reconstructing why a claim was rejected weeks later is currently impossible.

**Acceptance Criteria**
- Every decision writes an audit record with inputs, provider, model, prompt version, and outcome
- Records are queryable by trace id, claim id, and campaign reference
- Sensitive fields are redacted per `logging_redaction.py` before persistence
- Records survive process restart
- Retention for audit records is configurable and documented

---

## Issue 14: Apply Per-Key Rate Limiting to Inference Endpoints
**Labels:** ai-service, security, performance, api, reliability
**Complexity:** Medium (150)

**Description**
`services/load_shedder.py` protects the service in aggregate, but there is no per-caller limit.
One misbehaving integration can consume the entire budget and trigger load shedding for every other
caller, turning a single client's bug into a service-wide outage.

**Acceptance Criteria**
- Limits are enforced per API key with configurable per-endpoint overrides
- Exceeded limits return `429` with standard rate-limit headers
- Per-key limiting composes with the existing load shedder without double-rejecting
- Rejections are exposed as metrics labelled by endpoint
- Tests cover per-key isolation and interaction with load shedding

---

## Issue 15: Add Image Quality Gates Before Inference
**Labels:** ai-service, feature, performance, evidence, product
**Complexity:** Medium (150)

**Description**
`services/preprocessing.py` prepares images for OCR and proof-of-life, but an unusable image —
far too small, near-black, or extremely blurry — is still sent to a paid provider, which returns a
low-quality result at full cost. Field uploads over poor connections produce these regularly.

**Acceptance Criteria**
- Images are checked for minimum resolution, exposure, and blur before dispatch
- Failing images return an actionable error naming the specific problem
- Thresholds are configurable and defaults are documented
- Gate rejections are counted as metrics by reason
- Tests cover each rejection reason and a passing image

---

## Issue 16: Expose Circuit Breaker State for Operators
**Labels:** ai-service, observability, ops, reliability, api
**Complexity:** Trivial (100)

**Description**
`services/circuit_breaker.py` opens and closes circuits around providers, but the current state is
not observable. During an incident an operator cannot tell whether a provider is being skipped
because its circuit is open or because it was never configured.

**Acceptance Criteria**
- Circuit state per provider is exposed as a metric
- State transitions emit structured log lines with the triggering reason
- An admin-only endpoint reports current state and time until retry
- Manual reset of a circuit is supported
- Tests cover transitions and the reported time-to-retry

---

## Issue 17: Calibrate and Document Fraud Score Thresholds
**Labels:** ai-service, feature, product, config, analytics
**Complexity:** Medium (150)

**Description**
`services/fraud_detection.py` produces a fraud signal, and explanation codes were standardized in
Wave 7, but the numeric thresholds separating pass, review, and reject are embedded in code with no
stated basis. Operators cannot tune sensitivity without a code change, and no one can say what a
given score means.

**Acceptance Criteria**
- Thresholds move to validated configuration with documented defaults
- The banding applied is included in the response alongside the raw score
- Threshold changes are recorded in the decision audit record
- A calibration report over the fixture set is committed
- Tests cover each band and the boundaries between them

---

## Issue 18: Prevent Cache Stampedes on Expiry
**Labels:** ai-service, performance, reliability, integration
**Complexity:** Medium (150)

**Description**
`services/cache.py` caches inference results keyed partly by artifact ids. When a popular entry
expires, every concurrent request for it misses simultaneously and all of them call the provider.
That converts a cache expiry into a cost and latency spike precisely under load.

**Acceptance Criteria**
- Concurrent misses for the same key result in a single upstream call
- Waiting requests receive the computed result rather than erroring
- A failed computation does not leave other requests blocked
- Single-flight suppression is exposed as a metric
- Tests simulate concurrent misses on one key

---

## Issue 19: Purge Expired Uploads and Artifacts on a Schedule
**Labels:** ai-service, privacy, ops, evidence, infrastructure
**Complexity:** Medium (150)

**Description**
`services/upload_sessions.py` persists sessions beyond process memory and `api/v1/uploads.py`
accepts chunked uploads, but nothing removes abandoned sessions or expired artifacts. Personally
identifiable evidence therefore accumulates indefinitely, which is both a storage cost and a privacy
exposure.

**Acceptance Criteria**
- A scheduled job removes abandoned upload sessions and their chunks after a configurable window
- Expired artifacts are purged in bounded batches
- A dry-run mode reports what would be removed
- Purge counts and reclaimed bytes are exposed as metrics
- In-progress uploads are never purged

---

## Issue 20: Enforce Per-Endpoint Request Size and Timeout Limits
**Labels:** ai-service, security, reliability, performance, api
**Complexity:** Trivial (100)

**Description**
Endpoints under `app/ai-service/api/v1/` accept documents, images, and free-text claims with
per-request `timeout` values supplied by the caller. Without server-side ceilings, a caller can
request an unbounded timeout or submit an oversized payload and occupy a worker far longer than the
service should permit.

**Acceptance Criteria**
- Each endpoint enforces a maximum request body size with a clear `413` response
- Caller-supplied timeouts are clamped to a server-side maximum
- Limits are configurable with documented defaults
- Rejections are counted as metrics by endpoint and reason
- Tests cover oversized bodies and excessive requested timeouts

---
