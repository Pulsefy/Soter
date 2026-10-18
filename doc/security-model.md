# Soter Security Model and Sensitive Data Handling

This document describes the threat model and the controls that Soter actually implements for
biometric evidence, recipient identity data, and value-bearing onchain operations. It exists so the
system's security posture can be reviewed as a whole instead of service by service.

Every claim below is grounded in the repository. Where a control is partial, misconfigured by
default, or absent, it is stated under [Known gaps and accepted risks](#known-gaps-and-accepted-risks)
rather than omitted. **This document does not describe controls the code does not implement.**

## How to read this document

- Citations use `path:line` references into this repository. Where a behaviour depends on
  configuration, the relevant environment variable and its default are named.
- "Backend" means `app/backend` (NestJS). "AI service" means `app/ai-service` (FastAPI).
  "Mobile" means `app/mobile` (Expo). "Frontend" means `app/frontend` (Next.js).
  "Contract" means `app/onchain` (Soroban/Rust).
- Anything marked **[GAP]** is a real limitation of the current code, not an aspiration.

## Primary sources reviewed

| Area | File |
| --- | --- |
| AI-service log redaction | `app/ai-service/logging_redaction.py` |
| AI-service config / secrets reporting | `app/ai-service/config.py` |
| AI-service app, CORS, redaction wiring | `app/ai-service/main.py` |
| Evidence org ownership + audit logging | `app/ai-service/services/evidence_access_control.py` |
| Artifact signed tokens (AI service) | `app/ai-service/services/artifact_access.py` |
| Artifact token endpoints (AI service) | `app/ai-service/api/v1/artifacts.py` |
| Resumable evidence upload + purge (AI service) | `app/ai-service/services/upload_sessions.py`, `app/ai-service/api/v1/uploads.py` |
| Decision audit store | `app/ai-service/services/decision_audit.py` |
| PII scrubber (payload-level) | `app/ai-service/services/pii_scrubber.py` |
| Outbound webhook signing + purge schedule | `app/ai-service/tasks.py` |
| Backend API-key auth + scopes | `app/backend/src/common/guards/api-key.guard.ts`, `app/backend/src/api-keys/scopes.guard.ts` |
| Backend HMAC (inbound webhooks) | `app/backend/src/common/guards/webhook-hmac.guard.ts`, `app/backend/src/common/hmac/hmac.service.ts` |
| Backend roles/org scoping | `app/backend/src/auth/roles.guard.ts`, `app/backend/src/common/guards/org-ownership.guard.ts` |
| Artifact ownership tokens (backend) | `app/backend/src/evidence/artifact-ownership-token.service.ts`, `app/backend/src/common/guards/artifact-token.guard.ts` |
| Evidence at rest | `app/backend/src/evidence/evidence.service.ts`, `app/backend/src/common/encryption/encryption.service.ts` |
| Retention + purge | `app/backend/src/retention-policy/*` |
| Tamper-evident audit log | `app/backend/src/audit/audit-chain.service.ts` |
| Mobile secure storage + requests | `app/mobile/src/services/secureStorage.ts`, `app/mobile/src/services/requestLayer.ts` |

---

## 1. Trust boundaries

```text
┌──────────────┐        ┌──────────────┐
│   Mobile     │        │  Frontend    │
│  (Expo app)  │        │ (Next.js)    │
└──────┬───────┘        └──────┬───────┘
       │  B1                   │  B2
       ▼                       ▼
┌────────────────────────────────────────┐
│            Backend (NestJS)             │
│  ApiKeyGuard → RolesGuard → ScopesGuard │
│  OrgOwnershipGuard · ArtifactTokenGuard │
└──────┬───────────────┬────────────┬─────┘
       │ B3            │ B4         │ B5
       ▼               ▼            ▼
┌─────────────┐  ┌───────────┐  ┌──────────┐
│ AI service  │  │ Evidence  │  │ Soroban  │
│  (FastAPI)  │  │  storage  │  │ contract │
└─────────────┘  └───────────┘  └──────────┘
       ▲
       │ B3b (signed outbound callback: X-Signature-256)
       └── Backend webhooks controller
```

### B1 — Mobile ↔ Backend

- **Transport:** HTTPS to `EXPO_PUBLIC_API_URL` (`app/mobile/src/config/index.ts:63`).
- **Credential:** the mobile request layer attaches a static build-time key as the `x-api-key`
  header when `EXPO_PUBLIC_API_KEY` is set (`app/mobile/src/services/requestLayer.ts:205-207`;
  `app/mobile/src/config/index.ts:122`).
- **Secrets on device:** WalletConnect session topic, bearer auth token, and refresh token are held
  in the platform Keychain/Keystore via `expo-secure-store` with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, which excludes them from iCloud/Android backups
  (`app/mobile/src/services/secureStorage.ts:80-110`). Reads fail closed and return `null`
  (`secureStorage.ts:100-110`). A one-shot migration evacuates those keys from `AsyncStorage`
  (`secureStorage.ts:174-220`).
- **Trust assumption:** the device is not fully trusted; the presence of a build-time API key means
  the credential is not per-user (see [GAP-1](#gap-1-static-shared-mobile-api-key)).

### B2 — Frontend ↔ Backend

- **Transport:** HTTPS to `NEXT_PUBLIC_API_URL`.
- **Credential:** the job-status client attaches `Authorization: Bearer <token>` supplied by the
  caller (`app/frontend/src/lib/jobStatusClient.ts:270,286`). Other reviewed fetchers send only
  `Content-Type`; the backend protects them with its global guards.
- **Backend protection:** a global guard chain runs on every non-`@Public()` route (see
  [Section 3](#3-authentication-and-authorization-by-boundary)).

### B3 — Backend ↔ AI service

- **Outbound request:** the backend calls the AI service over HTTP (`AI_SERVICE_URL`,
  `app/backend/src/verification/verification.service.ts:164-168`) and sends only
  `Content-Type` and   `x-correlation-id` (`verification.service.ts:663-679`).
  **[GAP-2](#gap-2-no-authentication-on-the-backend-to-ai-service-hop)** — there is no shared secret
  on this hop; the AI service does not authenticate inbound callers.
- **Inbound callback (AI service → backend):** task completion is POSTed to
  `BACKEND_WEBHOOK_URL` and, when `AI_WEBHOOK_SECRET` is set, signed with HMAC-SHA256 in the
  `X-Signature-256` header (`app/ai-service/tasks.py:240-248`, `:317-319`). The backend verifies it
  with `WebhookHmacGuard` on `POST /webhooks/ai-verification`
  (`app/backend/src/webhooks.controller.ts:18-31`), using a timing-safe comparison against the raw
  request body (`app/backend/src/common/hmac/hmac.service.ts:15-30`,
  `app/backend/src/common/guards/webhook-hmac.guard.ts:20-40`).
- **Raw-body capture:** the backend preserves the raw body specifically so signature verification
  covers exactly the bytes received (`app/backend/src/main.ts:47-58`).

### B4 — Backend ↔ Evidence storage

- Evidence bytes are encrypted with AES-256-GCM before they reach any storage driver
  (`app/backend/src/evidence/evidence.service.ts:133-140`, `app/backend/src/common/encryption/encryption.service.ts:106-115`).
  Encrypted bytes are staged on local disk, then handed to the configured `StorageService`
  (`evidence.service.ts:192-205`).
- Access to the resulting artifact is mediated by artifact ownership tokens (Section 3).

### B5 — Backend ↔ Contract (value-bearing operations)

- Onchain writes go through the backend `AidEscrowService` and are exposed on
  `onchain/aid-escrow` routes guarded by role checks
  (`app/backend/src/onchain/aid-escrow.controller.ts`). Solana/Soroban transaction signing uses
  operator/admin keys held in environment configuration, not in the request path.
- Key custody policy is documented separately in `docs/admin-key-policy-testnet.md` (Ed25519
  keypairs, testnet/mainnet separation, deployer vs admin/operator separation, no keys in-repo).
- **Contract is the final authority** for escrow state: value-bearing state changes are reversible
  only by contract rules, not by the backend.

---

## 2. Sensitive data inventory

### 2.1 Biometric and evidence material

| Question | Answer |
| --- | --- |
| Where it lives | Evidence buffers are encrypted (AES-256-GCM) at intake and stored via the storage driver (`evidence.service.ts:133-205`). The AI service also persists chunked evidence uploads to `EVIDENCE_UPLOAD_DIR` and finalized artifacts under that directory (`app/ai-service/api/v1/uploads.py:42-59`). Proof-of-life selfies are processed in memory from base64 request bodies (`app/ai-service/main.py:276-280`). |
| How long | Backend: governed by `RetentionPolicy` for `SessionSubmission` (90 days) and `Claim` (365 days) (`retention-policy.service.ts:139-151`). AI service: finalized upload artifacts default to 30 days (`EVIDENCE_ARTIFACT_RETENTION_SECONDS`, `uploads.py:49-51`); in-progress upload sessions default to a 1-hour TTL (`uploads.py:46-48`). |
| Who can read | Backend operators/admins for the queue (`evidence.controller.ts:132-141`), constrained by owner scoping in the service (`evidence.service.ts:257-262`). AI-service artifact reads require `admin`/`operator`/`reviewer` plus a matching org on the artifact metadata, or a valid signed token (`artifacts.py:68-183`, `:185-271`). |
| Duplicate handling | Exact and near-duplicate uploads are detected by hash/fingerprint and the duplicate is rejected or referenced rather than re-stored (`evidence.service.ts:41-130`). |

### 2.2 Recipient identity data

| Question | Answer |
| --- | --- |
| Where it lives | Recipient imports carry `name`, `wallet`, and `phone` (`app/backend/src/recipients/recipients.service.ts:44-52`, `:104-151`); the import report echoes those columns (`recipients.service.ts:194`). Claims carry a `recipientRef`, which the retention policy can anonymize (`retention-policy.service.ts:800-833`). On the AI service, identity-document fields are extracted by OCR and passed through the PII scrubber before LLM use (`app/ai-service/services/pii_scrubber.py:40-60`, `:300-312`). |
| How long | `Session` records are anonymized after 90 days and `SessionSubmission` is hard-deleted after 90 days; `Claim` is soft-deleted after 365 days (`retention-policy.service.ts:126-155`). |
| Who can read | Authenticated backend callers with sufficient role/scope; NGO-scoped callers are limited to their own org by `OrgOwnershipGuard` (`app/backend/src/common/guards/org-ownership.guard.ts:14-45`). |
| Redaction | Free-text names/locations/dates/emails/phones/IDs are masked to category tokens by the PII scrubber (`pii_scrubber.py:300-312`); structured OCR fields are mapped by field name to `RECIPIENT_NAME`, `EVENT_DATE`, `ID_NUMBER`, `PHONE_NUMBER`, `EMAIL_ADDRESS`, or `LOCATION` (`pii_scrubber.py:325-343`). |

### 2.3 Value-bearing onchain operations

| Question | Answer |
| --- | --- |
| Where it lives | Package lifecycle and claim state on the Soroban `aid_escrow` contract; mirrored in backend records for orchestration and reporting. |
| How long | Contract state is permanent by design; it is the audit anchor for disbursement. Backend mirror rows follow the retention table below. |
| Who can read | Contract state is public onchain. Off-chain callers reach write paths through role-guarded backend routes (`aid-escrow.controller.ts:47-70`). |
| Authorization | Contract admin/distributor authorization is enforced inside the contract; backend routes add `@Roles(...)` (e.g. campaign/operator roles) on top. |
| Key material | Operator/admin keys live only in environment configuration; see `docs/admin-key-policy-testnet.md`. |

### 2.4 Credentials and API keys

| Question | Answer |
| --- | --- |
| Where it lives | API keys are stored as SHA-256 hashes plus a masked preview in the `ApiKey` table (`app/backend/src/api-keys/api-keys.service.ts:315-317`, `:418-431`). Raw keys are only returned at creation/rotation (`api-keys.service.ts:428-431`, `:560-566`). |
| Format | `s2s_` prefix + 32 random bytes, base64url (`api-keys.service.ts:312-314`). |
| Lookup | Hashed lookup with a plaintext fallback column (`app/backend/src/common/guards/api-key.guard.ts:56-63`) — see [GAP-3](#gap-3-plaintext-api-key-fallback-column). |
| Lifecycle | Revocation, expiry, and rotation with a bounded overlap window are enforced at authentication time (`api-key.guard.ts:70-95`); rotation writes a replacement and a `graceExpiresAt` (`api-keys.service.ts:489-582`). |

### 2.5 Audit and decision records

| Question | Answer |
| --- | --- |
| Where it lives | Backend: `AuditLog` rows forming a hash chain (`app/backend/src/audit/audit-chain.service.ts:86-170`). AI service: append-only JSONL at `DECISION_AUDIT_PATH` (default `./audit/decision_audit.jsonl`, `app/ai-service/config.py:178-183`). |
| How long | Backend `AuditLog` is soft-deleted after 365 days (`retention-policy.service.ts:120-124`). Decision audit defaults to 90 days, with `0` meaning retain forever (`config.py:293-306`; `decision_audit.py:276-302`). |
| Who can read | Backend audit endpoints are role-guarded; decision-audit records are queried via `/v1/ai/decision-audit` endpoints. The JSONL file itself has no per-record access control beyond filesystem permissions — see [GAP-7](#gap-7-decision-audit-file-has-no-field-level-access-control). |
| Integrity | The backend audit chain is tamper-evident: entries are hash-linked and verified by walking the chain (`audit-chain.service.ts:172-353`). Retention's `anonymize` strategy deliberately rewrites content and marks rows `deletedAt`, which the verifier treats as intentionally destroyed and skips content checks (`audit-chain.service.ts:295-306`). |

### 2.6 Cached data

- AI verification responses are cached keyed by claim/artifact/model version with a 120-second TTL
  (`config.py:188-190`). Artifact-access metadata is cached for 60 seconds (`config.py:189`).
- Cache invalidation for artifacts is an explicit admin/operator action
  (`app/ai-service/api/v1/artifacts.py:273-322`).

---

## 3. Authentication and authorization by boundary

### B1/B2 — Clients to backend

The backend registers three global guards, in order, so every non-`@Public()` route is
authenticated, then role-checked, then scope-checked
(`app/backend/src/app.module.ts:223-246`):

1. **`ApiKeyGuard`** — reads `x-api-key`, hashes it, looks up the `ApiKey` record, and rejects
   revoked, expired, or post-grace rotated keys (`api-key.guard.ts:35-111`). It sets
   `request.user` with `role`, `ngoId`, `apiKeyId`, and `scopes`.
2. **`RolesGuard`** — enforces `@Roles(...)` against `request.user.role`
   (`app/backend/src/auth/roles.guard.ts:9-34`).
3. **`ScopesGuard`** — enforces `@Scopes(...)` using a hierarchy: `read` (1) < `write` (2) <
   `admin` (3); `webhook` (4) is *not* implied by `admin` and must be present explicitly
   (`app/backend/src/api-keys/scopes.guard.ts:8-85`, `app/backend/src/api-keys/api-key-scope.enum.ts`).

Additional per-route guards:

- **`OrgOwnershipGuard`** limits NGO-scoped callers to resources carrying their own `ngoId`; admins
  bypass (`org-ownership.guard.ts:14-45`).
- **`ArtifactTokenGuard`** requires a valid artifact ownership token for marked routes
  (`app/backend/src/common/guards/artifact-token.guard.ts:31-98`).
- **`WebhookHmacGuard`** authenticates inbound AI callbacks by HMAC signature rather than API key
  (`webhook-hmac.guard.ts:20-40`).

Endpoints intentionally reachable without an API key are marked `@Public()` — health, app info,
some analytics, release config, and sandbox
(`app/backend/src/common/decorators/public.decorator.ts`;
e.g. `app/backend/src/health/health.controller.ts:31,64,97`;
`app/backend/src/analytics/analytics.controller.ts:81,108,133`).

### B3 — Backend to AI service

- **Inbound (AI service):** the AI service does not authenticate callers. Its protections are
  per-endpoint authorization inputs and rate limiting, not identity:
  - Artifact endpoints require explicit `X-User-Role`, `X-Org-Id`, and `X-User-Id` headers and
    enforce role + org ownership (`artifacts.py:80-183`).
  - Evidence upload sessions are owned by the caller-supplied `X-User-Id`
    (`app/ai-service/api/v1/uploads.py:100-137`, `:140-169`).
  - CORS is allowlist-based, and the artifact route explicitly rejects any CORS origin
    (`app/ai-service/main.py:307-340`, `config.py:645-717`).
  - Per-client and per-endpoint rate limits apply (`config.py:112-130`).
- **Outbound callback (backend):** HMAC-SHA256 over the exact body, hex-encoded, header
  `X-Signature-256`, timing-safe comparison (`hmac.service.ts:11-30`; `webhook-hmac.guard.ts:20-40`).
  The secret is `AI_WEBHOOK_SECRET` on both sides and must be at least 16 characters and not the
  example placeholder (`config.py:34-40`, `:337-350`).

### Evidence artifact access tokens

Two independent token systems exist; both are HMAC-SHA256 and short-lived:

- **AI service (`ArtifactAccessService`)** — token `base64url(payload).base64url(sig)` with
  `{aid, org, sub, exp}`; signature verified with `hmac.compare_digest`, expiry checked, org
  re-checked against artifact metadata on download
  (`app/ai-service/services/artifact_access.py:108-230`; `artifacts.py:185-271`). TTL defaults to
  300 seconds (`config.py:256-258`). Signing secret must be ≥16 chars
  (`artifact_access.py:32-41`).
- **Backend (`ArtifactOwnershipTokenService`)** — token bound to artifact, org, user, and role;
  TTL must be 1–3600 seconds, default 300; the token hash is persisted for revocation and both
  creation and revocation are audited
  (`app/backend/src/evidence/artifact-ownership-token.service.ts:57-120`, `:180-224`).

Both deny cross-organization access. Anti-enumeration is explicit: a cross-org denial returns the
same 404 as a missing artifact, with the true reason kept only in the audit log
(`artifacts.py:126-150`, `:236-250`).

### B5 — Backend to contract

- Onchain routes use the same global API-key/role guards plus `@Roles(...)` for privileged
  operations (`aid-escrow.controller.ts`). Contract-level authorization (admin/distributor) is
  enforced inside the Soroban contract; the backend cannot override it.

---

## 4. Redaction, retention, and purge by service

### 4.1 AI service

**Redaction**

- A `RedactionFilter` is attached to the JSON log handler so every emitted record is masked before
  it leaves the process (`app/ai-service/main.py:83-87`). It rewrites the rendered message, clears
  positional args, and masks any string in `extra=...` (`logging_redaction.py:136-180`).
- Patterns cover key/value secrets (`api_key`, `token`, `password`, `authorization`, …), bearer
  headers, JWTs, OpenAI-style `sk-` keys, emails, SSNs, card numbers, phone numbers, and IPv4
  addresses (`logging_redaction.py:44-87`). Redaction is idempotent and fail-safe — it never drops
  or raises (`logging_redaction.py:90-101`, `:141-164`).
- Boot configuration reporting logs only `<set>`/`<unset>` for secret fields
  (`config.py:27-37`, `:594-619`).
- Payload-level PII scrubbing (names, locations, dates, and structured OCR fields) is a separate
  service used before LLM calls (`pii_scrubber.py`).

**Retention / purge**

- Decision audit records are redacted *before* persistence and pruned according to
  `DECISION_AUDIT_RETENTION_DAYS` (default 90; `0` = forever); pruning compacts the JSONL atomically
  (`decision_audit.py:276-302`, `:228-247`).
- Evidence upload purge runs hourly via Celery beat: it removes expired, never-finalized upload
  sessions and finalized artifacts older than `EVIDENCE_ARTIFACT_RETENTION_SECONDS`, in bounded
  batches (`tasks.py:62-65`; `upload_sessions.py:214-289`; `uploads.py:219-260`). In-progress
  sessions are never touched.

### 4.2 Backend

**Redaction**

- Request logging goes through an interceptor (`app/backend/src/interceptors/logging.interceptor.ts`);
  the mobile and frontend clients each redact bearer tokens/JWTs in their own diagnostics
  (`app/mobile/src/services/logger.ts:28-39`, `app/frontend/src/lib/diagnostics.ts:66-67`).
- Sensitive error responses avoid leaking artifact existence (Section 3).

**Retention / purge**

- Policies are stored in the `RetentionPolicy` table and seeded with these defaults
  (`app/backend/src/retention-policy/retention-policy.service.ts:119-158`):

| Entity | Retention | Strategy | Effect |
| --- | --- | --- | --- |
| `AuditLog` | 365 days | `soft_delete` | Sets `deletedAt`; rows remain in the DB |
| `VerificationSession` | 180 days | `hard_delete` | Row deleted |
| `Session` | 90 days | `anonymize` | `metadata` emptied; submissions `payload`/`response` emptied |
| `SessionSubmission` | 90 days | `hard_delete` | Row deleted |
| `Claim` | 365 days | `soft_delete` | Sets `deletedAt` |
| `VerificationRequest` | 180 days | `hard_delete` | Row deleted |

- A daily 00:00 UTC cron enqueues a purge job; an hourly cron enqueues idempotency-key expiry
  (`app/backend/src/retention-policy/retention-purge.scheduler.ts:26-110`). Each purge writes an
  audit event with entity, strategy, cutoff, and affected count
  (`retention-policy.service.ts:252-269`).
- Anonymization replaces sensitive fields with the literal `[REDACTED]` and clears JSON payloads
  (`retention-policy.service.ts:652`, `:800-833`).
- Idempotency keys expire 24 hours after creation by default and are purged hourly in bounded
  batches (`app/backend/src/retention-policy/idempotency-key-retention.config.ts:16-20`).

**Integrity**

- Audit logs are hash-chained and verifiable, so deletion or mutation in the middle of the chain is
  detectable (`audit-chain.service.ts:172-353`).

---

## 5. Known gaps and accepted risks

These are real properties of the current code. They are listed so reviewers can weigh them
explicitly.

### GAP-1: Static shared mobile API key

The mobile app attaches a single build-time API key (`EXPO_PUBLIC_API_KEY`) from app configuration
(`app/mobile/src/services/requestLayer.ts:205-207`, `app/mobile/src/config/index.ts:122`). Any key
shipped in a mobile binary can be extracted; the credential is not bound to a device or a user, and
revoking it affects every installation at once. Per-user JWTs exist in secure storage
(`app/mobile/src/services/secureStorage.ts:44-60`) but the reviewed request layer does not use them
for API calls.

### GAP-2: No authentication on the backend to AI-service hop

The backend calls the AI service with only `Content-Type` and `x-correlation-id`
(`app/backend/src/verification/verification.service.ts:663-679`). The AI service has no inbound
credential check on `/v1/ai/*` (only rate limiting, load shedding, CORS, and per-endpoint header
authorization). Anyone who can reach the AI service port can call it. The accepted mitigation is
network isolation; there is no application-layer identity on this boundary.

### GAP-3: Plaintext API-key fallback column

`ApiKeyGuard` looks keys up with `OR: [{ keyHash }, { key }]`
(`app/backend/src/common/guards/api-key.guard.ts:58-63`), so a row whose plaintext `key` column is
populated will authenticate directly from a stored plaintext value. The primary path stores only a
hash (`api-keys.service.ts:418-421`), but the fallback weakens the at-rest guarantee.

### GAP-4: Environment API key grants full admin scope

If the presented key matches the `API_KEY` environment variable and no database record exists, the
caller is treated as `AppRole.admin` with the `admin` scope
(`app/backend/src/common/guards/api-key.guard.ts:113-126`). This is a deliberate,
no-scope-narrowing break-glass credential.

### GAP-5: Missing scopes default to admin

Both `parseScopes` implementations return `[ApiKeyScope.admin]` when the `scopes` column is empty or
unparseable (`api-key.guard.ts:12-21`, `app/backend/src/api-keys/api-keys.service.ts:91-100`). A key
created without scopes is therefore maximally privileged rather than least-privileged.

### GAP-6: Insecure fallback secrets when configuration is absent

- `EncryptionService` falls back to a hardcoded master key when `ENCRYPTION_MASTER_KEY` is unset,
  logging a warning (`app/backend/src/common/encryption/encryption.service.ts:17-29`). Evidence
  encrypted under the fallback key is trivially decryptable by anyone with the source.
- `ArtifactOwnershipTokenService` falls back to a hardcoded signing secret when
  `ARTIFACT_TOKEN_SIGNING_SECRET` is unset or shorter than 32 characters
  (`artifact-ownership-token.service.ts:43-51`), which would let a token be forged.
- The AI service generates a fresh `artifact_signing_secret` at process start when
  `ARTIFACT_SIGNING_SECRET` is unset (`app/ai-service/config.py:258`). That is safe against
  forgery but means signed URLs are invalidated on restart and **cannot be verified across multiple
  instances/replicas** unless the secret is configured explicitly.

### GAP-7: Decision audit file has no field-level access control

Decision audit records are stored as a plain JSONL file at `DECISION_AUDIT_PATH`
(`app/ai-service/services/decision_audit.py:150-180`). Redaction is applied before write
(`decision_audit.py:75-89`, `:341-350`), but any process with filesystem access to that path can
read every record. There is no encryption at rest and no per-record authorization beyond the
service's own query endpoints.

### GAP-8: Log redaction is heuristic

`logging_redaction.py` matches secrets and structured PII by regular expression
(`logging_redaction.py:44-87`). It does not detect free-text names, locations, or dates — those are
only handled when code explicitly calls the PII scrubber. A new log line that interpolates a
person's name will not be redacted by pattern matching.

### GAP-9: `ArtifactOwnershipTokenService` allows unowned artifacts

`validateArtifactOwnership` returns `true` when the artifact has no `orgId` (`!artifact.orgId ||
artifact.orgId === orgId`, `artifact-ownership-token.service.ts:228-246`). Legacy artifacts with no
organization are accessible to any caller who can obtain a token for that artifact id.

### GAP-10: Broad default CORS wildcard

AI-service CORS defaults to allowing `https://*.vercel.app` because
`cors_allow_vercel_previews` defaults to `True` (`app/ai-service/config.py:264`, `:665-667`).
Wildcard preview origins can be controlled by third parties under the `vercel.app` suffix. The
artifact endpoints opt out of CORS entirely (`main.py:307-340`), which limits the exposure, but the
default should be revisited for production.

### GAP-11: Evidence uploads do not bind `orgId` from the authenticated principal

The backend `EvidenceController.upload` calls `queueEvidence(file, ownerId)` without passing
`orgId` (`app/backend/src/evidence/evidence.controller.ts:88-97`), while duplicate detection and
storage-key layout are org-scoped (`evidence.service.ts:52-58`, `:199-203`). The AI-service upload
sessions likewise take ownership only from the caller-supplied `X-User-Id`
(`app/ai-service/api/v1/uploads.py:100-137`). Until org identity is derived from the authenticated
principal, org scoping for these paths is weaker than the artifact-access path.

### GAP-12: Retention defaults leave copies reachable

`AuditLog` and `Claim` use `soft_delete`, which stamps `deletedAt` but leaves the data in place
(`retention-policy.service.ts:290-329`, `:410-470`). Soft-deleted rows remain queryable by anyone
with database access. Hard deletion and anonymization only apply to the entities configured with
those strategies.

### GAP-13: HMAC secret is optional on the outbound path

If `AI_WEBHOOK_SECRET` is unset, the AI service logs a warning and sends the callback unsigned
(`app/ai-service/tasks.py:243-248`). The backend guard will then reject it, so the failure mode is a
dropped callback rather than an accepted forged one — but it is a silent-degradation path to be
aware of during incident response.

---

## 6. Review checklist for changes touching sensitive data

1. Does the change add a new class of sensitive data? If so, add it to Section 2 with location,
   retention, and readers.
2. Does it touch a trust boundary in Section 1? State which credential (API key, artifact token,
   HMAC, role/scope) protects the new path.
3. Does it log anything new? Confirm the value is masked by `logging_redaction.py` or explicitly
   passed through the PII scrubber. Name/location/date fields will not be auto-redacted.
4. Does it add a new retention obligation? Add a `RetentionPolicy` seed rather than relying on
   ad-hoc deletion.
5. Does it introduce a new secret? Give it a real default-free configuration path and fail fast when
   it is absent (see the existing `validate_configuration()` pattern in
   `app/ai-service/config.py:311-591`).
6. If it changes authorization, update Section 3 and add the corresponding guard test.
