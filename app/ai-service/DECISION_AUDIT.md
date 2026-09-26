# Decision Audit Records

> Issue #990 — *Write a Structured Decision Audit Record for Every Verification*

Verification and fraud endpoints return decisions that influence whether aid is
disbursed. This document describes the durable audit trail behind those
decisions: what is recorded, how to query it, what is redacted, and how long
records are kept.

---

## 1. What gets recorded

Every decision made by these endpoints writes exactly one audit record per
decision:

| Endpoint | `decision_type` | Records written |
| --- | --- | --- |
| `POST /v1/ai/humanitarian/verify` | `humanitarian_verification` | one per request |
| `POST /v1/fraud/detect` | `fraud_detection` | **one per claim** in the batch |

Failures are decisions too. An access-control denial, a misconfigured provider,
or an exhausted-provider error each writes a record with an `error` or `denied`
outcome, so "nothing happened for this claim" is itself reconstructable.

### Record shape

Written as one JSON object per line (JSON Lines) by
[`services/decision_audit.py`](services/decision_audit.py):

| Field | Description |
| --- | --- |
| `record_id` | `da_<uuid4hex>` — stable handle for a single decision |
| `created_at` | Unix timestamp the decision was recorded |
| `decision_type` | `humanitarian_verification` \| `fraud_detection` |
| `outcome` | `eligible`, `ineligible`, `completed`, `flagged`, `cleared`, `denied`, `error` |
| `trace_id` | Correlation ID (`X-Correlation-Id` / `X-Request-Id`), echoed as `trace_id` on the original response |
| `claim_id` | Claim identifier — `anchor_metadata.claim_id`, or the batch claim's own ID for fraud decisions |
| `campaign_ref` | `anchor_metadata.campaign_ref` |
| `package_id` | `anchor_metadata.package_id` |
| `org_id` | Requesting organization (`X-Org-Id`) |
| `provider` | LLM provider that produced the decision (`openai`, `groq`, `test`), or `internal` for fraud scoring |
| `model` | Model identifier, e.g. `gpt-4o` or `sklearn.LocalOutlierFactor` |
| `prompt_version` | `HUMANITARIAN_PROMPT_VERSION` for verification; `FRAUD_RULES_VERSION` for fraud scoring |
| `prompt_variant` | `primary` or `fallback` — which prompt actually succeeded |
| `confidence` | Aggregate confidence in `[0, 1]` |
| `reasons` | Human-readable reasons behind the outcome |
| `inputs` | Request-side material the decision was made from (claim text, evidence, context factors, artifact IDs, claim metadata) |
| `metadata` | Decision-specific extras (raw verification object, risk score, status code, batch size) |
| `schema_version` | On-disk record schema version, currently `1` |

### Versioning the decision logic

* `HUMANITARIAN_PROMPT_VERSION` in
  [`services/humanitarian_prompt.py`](services/humanitarian_prompt.py) — **bump
  it whenever the system or user prompt text changes.** Without this, a record
  cannot be tied to the exact prompt that produced it.
* `FRAUD_RULES_VERSION` in
  [`services/fraud_detection.py`](services/fraud_detection.py) — fraud scoring
  is statistical rather than prompt-driven, so this constant plays the same
  role. Bump it whenever the feature set or `_OUTLIER_THRESHOLD` changes.

---

## 2. Querying records

Records are indexed by **trace ID**, **claim ID**, and **campaign reference**.

```
GET /v1/ai/decision-audit?claim_id=claim-abc123
GET /v1/ai/decision-audit?trace_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
GET /v1/ai/decision-audit?campaign_ref=campaign-2024-001&decision_type=fraud_detection
GET /v1/ai/decision-audit/{record_id}
```

* At least one of `trace_id`, `claim_id`, or `campaign_ref` is required — an
  unfiltered dump of every decision is neither useful for an investigation nor
  a safe default.
* Supplying several identifiers narrows the result (logical AND).
* `limit` defaults to 100, capped at 500. Records come back newest first.
* Responses use the standard `ResultEnvelope`.

**Typical investigation:** a claim was rejected weeks ago. Query by
`claim_id`, read `outcome` and `reasons`, then read `provider`, `model`, and
`prompt_version` to identify exactly which decision logic ran, and `inputs` to
see what it ran on.

---

## 3. Redaction

Every string in a record — including strings nested inside `inputs`, `reasons`,
and `metadata` — is passed through
[`logging_redaction.py`](logging_redaction.py)'s `redact()` **before the record
is serialised to disk**. Emails, phone numbers, card and SSN patterns, IP
addresses, bearer tokens, JWTs, and `key=value` secrets are masked with
`[REDACTED]`.

Deliberately **not** redacted: `record_id`, `created_at`, `decision_type`,
`outcome`, `trace_id`, `claim_id`, `campaign_ref`, `package_id`, `confidence`,
and `schema_version`. These are correlation handles and scores, not PII, and
masking them would destroy the indexes the audit trail exists to serve.

Because redaction happens at write time, records served by the query endpoints
carry no raw PII either.

---

## 4. Durability

Storage is an append-only JSON Lines file. Each append is `flush()`ed and
`os.fsync()`ed, so a record survives an abrupt process kill. On startup the
service replays the file and rebuilds all three query indexes, so **records and
their queryability both survive a restart**. Malformed lines (a torn write from
a hard kill) are skipped with a warning rather than blocking boot.

> **Production requirement:** `DECISION_AUDIT_PATH` must point at a persistent
> volume. A container-local path is lost on redeploy, which defeats the purpose
> of the audit trail.

---

## 5. Retention (configurable)

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `DECISION_AUDIT_ENABLED` | `true` | Master switch. `false` makes every write a no-op. |
| `DECISION_AUDIT_PATH` | `./audit/decision_audit.jsonl` | Append-only log location. |
| `DECISION_AUDIT_RETENTION_DAYS` | `90` | Records older than this are dropped. **`0` retains forever.** |

The retention sweep runs:

1. **at startup** — so an instance that was down past the retention window
   compacts its log before serving, and
2. **periodically while serving** — every 100 appends, since pruning rewrites
   the whole log and must not run per write.

Pruning rewrites the log atomically (temp file + `os.replace`), so a crash
mid-prune leaves the previous log intact. `DecisionAuditStore.prune()` can also
be called directly and returns the number of expired records dropped.

Configuration is validated at boot: a negative `DECISION_AUDIT_RETENTION_DAYS`,
or a blank `DECISION_AUDIT_PATH` while auditing is enabled, fails startup via
`Settings.validate_configuration()`.

### Choosing a retention window

* **90 days (default)** — covers the usual dispute and reconciliation cycle.
* **`0` (retain forever)** — the compliance-archive configuration, for donors
  or regulators requiring an indefinite disbursement trail. Plan for log growth
  and archive the file externally.
* **Shorter windows** — acceptable in development, but any window shorter than
  the dispute window means some rejections become unexplainable.

Auditing never blocks a decision: storage failures are logged and swallowed, so
an audit-disk problem cannot turn a completed verification into a 500.

---

## 6. Related code

| File | Role |
| --- | --- |
| [`services/decision_audit.py`](services/decision_audit.py) | Record model, durable store, redaction, retention |
| [`api/v1/decision_audit.py`](api/v1/decision_audit.py) | Query endpoints |
| [`api/v1/humanitarian.py`](api/v1/humanitarian.py) | Writes verification decisions (success, denial, error) |
| [`api/v1/fraud.py`](api/v1/fraud.py) | Writes one record per scored claim |
| [`logging_redaction.py`](logging_redaction.py) | The redaction rules applied before persistence |
| [`tests/test_decision_audit.py`](tests/test_decision_audit.py) | One test class per acceptance criterion |
