# Documentation Issues

## Wave 8

Wave 7 delivered the cross-service architecture guide, the local development runbook, the testnet
operations runbook, the theming guide, and the contract deployment workflow. Wave 8 documentation
covers the reference material those runbooks assume exists but which has never been written down:
what is still mocked, what error codes and contract entry points mean, how AI providers are
operated, and how sensitive data is handled.

---

## Issue 1: Publish a Mock and Placeholder Inventory
**Labels:** documentation, docs, architecture, devex, product
**Complexity:** Medium (150)

**Description**
Mock implementations remain scattered across every service, and there is no single place that
records which paths are real and which are simulated. A contributor cannot currently tell whether a
feature works or merely appears to. Concrete examples include
`app/backend/src/claims/claims.service.ts` generating package ids via `generateMockPackageId`,
`app/backend/src/aid/aid.service.ts` hardcoding `'mock-c-id'`,
`app/backend/src/evidence/evidence.service.ts` simulating object storage,
`app/backend/src/notifications/notifications.processor.ts` logging instead of delivering,
`app/frontend/src/lib/mock-api/` still imported by production components, and
`app/mobile/src/services/mockData.ts` backing `HealthScreen` and `AidDetailsScreen`.

Produce a maintained inventory so the remaining gap between demo and production is legible.

**Acceptance Criteria**
- A document in `doc/` lists every known mock, stub, and placeholder with its file path
- Each entry states what is simulated, what depends on it, and what replacing it requires
- Entries link to the tracking issue where one exists
- The document distinguishes intentional test doubles from unfinished production paths
- The process for keeping the inventory current is stated

---

## Issue 2: Write the API Error Code Reference
**Labels:** documentation, docs, api, devex, integration
**Complexity:** Medium (150)

**Description**
Frontend and mobile clients currently interpret backend failures from HTTP status codes and
human-readable message strings, which is why error handling is inconsistent across clients. Once the
backend publishes stable error codes, those codes need a reference that client authors and external
integrators can rely on.

**Acceptance Criteria**
- Every error code is documented with its identifier, HTTP status, meaning, and likely cause
- Each entry states whether the condition is retryable and how a client should respond
- The response envelope shape, including the correlation identifier, is documented
- Contract error codes returned through the onchain adapter are cross-referenced
- The policy for adding, deprecating, and never reusing codes is stated

---

## Issue 3: Write the Aid Escrow Contract Interface Reference
**Labels:** documentation, docs, Soroban, Contract, onchain, devex
**Complexity:** Hard (200)

**Description**
`app/onchain/contracts/aid_escrow/src/lib.rs` exposes more than forty public entry points
covering admin transfer, versioning and migration, distributors, configuration, layered pausing,
funding, package lifecycle, Merkle proof claims, surplus withdrawal, aggregates, and delegates. The
existing contract documents cover events, gas profiling, reconciliation, and boundary validation, but
no document describes the callable interface itself, so integrators must read Rust source to learn
what a function does or who may call it.

**Acceptance Criteria**
- Every public entry point is documented with parameters, return type, and errors
- Authorization requirements are stated per function, including admin and distributor roles
- Interactions with global, action, and campaign pause state are described
- The two overlapping expiry extension functions are documented with guidance on which to use
- Events emitted by each state-changing function are cross-referenced to `EVENTS.md`

---

## Issue 4: Write the AI Provider and Prompt Operations Guide
**Labels:** documentation, docs, ai-service, ops, config
**Complexity:** Medium (150)

**Description**
`app/ai-service/services/providers.py` supports multiple providers with circuit breaking, load
shedding, caching, and dead-letter handling, and prompts are constructed in
`services/humanitarian_prompt.py`. None of the operational knowledge around this is written down:
how to add a provider, how fallback is chosen, what a prompt change implies, or how cost behaves.

**Acceptance Criteria**
- Adding and configuring a new provider is documented end to end
- Fallback selection, circuit breaking, and load shedding interactions are explained
- The prompt change process, including versioning and evaluation, is documented
- Caching and invalidation behaviour is described, including what is safe to cache
- Cost drivers and the levers available to control them are stated

---

## Issue 5: Document the Security Model and Sensitive Data Handling
**Labels:** documentation, docs, security, privacy, evidence, governance
**Complexity:** Hard (200)

**Description**
Soter handles biometric evidence, recipient identity data, and value-bearing onchain operations,
with controls spread across services: `app/ai-service/logging_redaction.py`,
`services/evidence_access_control.py`, the backend HMAC and API key scope guards, artifact access
tokens, and retention policies. No document states what the threat model is or how these controls fit
together, which makes it impossible to review the system's security posture as a whole.

**Acceptance Criteria**
- Trust boundaries between mobile, frontend, backend, AI service, and contract are described
- Each class of sensitive data is documented with where it lives, how long, and who can read it
- Authentication and authorization mechanisms are described per boundary, including HMAC and API key scopes
- Redaction, retention, and purge behaviour is documented per service
- Known gaps and accepted risks are stated explicitly rather than omitted

---
