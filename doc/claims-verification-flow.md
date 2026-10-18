# Claims-to-Verification Flow (Current and Target State)

This document describes how the **claims** subsystem
(`app/backend/src/claims/`) and the **verification** subsystem
(`app/backend/src/verification/`) relate to each other: the two lifecycles side
by side, how they are connected today, the drift that connection can produce,
and the target state the wave's wiring work is moving toward.

> Status: describes the code as of the Wave 9 claims/verification wiring work.
> Update this document as part of any change that alters the wiring, rather than
> letting it describe a stale state.

## The two lifecycles

### Claim lifecycle (`ClaimStatus`)

`ClaimStatus` is a Prisma enum (`app/backend/prisma/schema.prisma`) with six
states. The transitions are driven by `ClaimsService`
(`app/backend/src/claims/claims.service.ts`):

| From | Method | To | Notes |
| --- | --- | --- | --- |
| — | `create()` | `requested` | Creates the claim and enqueues verification (`enqueueVerificationForClaim`). |
| `requested` | `verify()` | `verified` | Idempotent if already `verified`. |
| `verified` | `approve()` | `approved` | |
| `approved` | `disburse()` | `disbursed` | Rejects any non-`approved` source status. Records a receipt pointer / correlation id. |
| `disbursed` | `archive()` | `archived` | |
| `requested`, `verified` | `cleanupExpiredClaims()` (cron) | `archived` | Expiry sweep. |
| any active | cancel / reissue flow | `cancelled` (+ new claim) | See `cancel-and-reissue.service.ts`; emits `claim.cancelled` / `claim.reissued` events. |

```
requested ──verify──▶ verified ──approve──▶ approved ──disburse──▶ disbursed ──archive──▶ archived
    │                    │
    └────── expiry ──────┴──▶ archived
    │
    └────── cancel ──▶ cancelled ──reissue──▶ (new claim in `requested`)
```

### Verification lifecycle

Verification does **not** live on the claim row. When a claim is created,
`ClaimsService.enqueueVerificationForClaim()` enqueues a verification job that is
processed by `verification.processor.ts` →
`VerificationService.processVerification()`. That pipeline scores the claim and
writes a **durable verification record** as an audit entity/action pair
(`VERIFICATION_AUDIT_ENTITY = 'verification'`,
`VERIFICATION_COMPLETE_ACTION = 'complete'`, see
`claim-verification-state.service.ts`), carrying a numeric `score` and a
`passed` flag evaluated against `DEFAULT_VERIFICATION_THRESHOLD = 0.7`.

```
claim.create ──enqueue──▶ verification job ──▶ processVerification()
                                                    │ score vs 0.7
                                                    ▼
                                      audit record { entity: 'verification',
                                                     action: 'complete',
                                                     score, passed }
```

## How the two are connected today (current state)

The claim row and the verification record are written by **separate
statements**, so the connection is *convention-enforced*, not transactional:

- A claim may only legitimately reach `verified`, `approved`, or `disbursed`
  once a **passing** verification record exists
  (`VERIFICATION_REQUIRED_STATUSES` in `claim-verification-state.service.ts`).
- `ClaimVerificationStateService` answers "is this claim's verification
  complete?" by reading the audit record, not the claim status.
- Because the two are written independently, they can **drift**. The
  `ClaimVerificationDrift` type names the two failure modes:
  - `verified_without_verification_record` — the claim moved past `requested`
    with no passing verification record (partial write, crashed worker, or a
    manual status flip).
  - `verification_record_not_reflected` — a passing verification was recorded
    but the claim never left `requested`.
- `claim-verification-reconciliation.service.ts` scans claims in
  `RECONCILED_CLAIM_STATUSES` (`requested` + the verification-required states;
  `archived` and `cancelled` are excluded) and reports this drift.

In short: **verification runs automatically on claim creation and leaves an
auditable record, but advancing the claim's status is a separate step.**
Reconciliation exists precisely because that gap can be crossed inconsistently.

## Target state

The wiring work aims to make the connection direct and consistent:

- A passing verification result should **drive** the claim's transition to
  `verified` (rather than relying on a separate manual `verify()` call), so the
  two records cannot silently disagree.
- Drift categories should trend to zero in steady state; reconciliation becomes
  a safety net for crashes/partial writes rather than an expected occurrence.
- The claim status and the verification record should be reconciled (ideally in
  one transaction, or with an idempotent follow-up) at the point verification
  completes.

## End-to-end sequence (creation through disbursement)

```
Operator ─create claim──────────────▶ ClaimsService.create()  → status: requested
                                         └─ enqueueVerificationForClaim()
Verification worker ─process job────▶ VerificationService.processVerification()
                                         └─ score vs 0.7 → audit record (passed?)
[target] passing result ────────────▶ claim status → verified
[current] operator/flow ─verify()───▶ claim status → verified
Reviewer ─approve()─────────────────▶ status: approved   (requires verified)
Disburser ─disburse()───────────────▶ status: disbursed  (requires approved; records receipt)
Lifecycle ─archive()/expiry─────────▶ status: archived
```

## Where to look in the code

- Claim transitions: `app/backend/src/claims/claims.service.ts`
- Claim/verification state & drift types: `app/backend/src/claims/claim-verification-state.service.ts`
- Reconciliation scan: `app/backend/src/claims/claim-verification-reconciliation.service.ts`
- Cancel/reissue events: `app/backend/src/claims/claim.events.ts`, `cancel-and-reissue.service.ts`
- Verification pipeline: `app/backend/src/verification/verification.processor.ts`, `verification.service.ts`, `verification-flow.service.ts`
- Integration test of the wiring: `app/backend/src/claims/claims-verification.integration.spec.ts`
