# Contract Issues

## Wave 8

Wave 8 contract work targets Soroban-specific durability concerns, interface cleanup in
`app/onchain/contracts/aid_escrow/src/lib.rs`, and the alignment surface the backend needs to
consume the contract reliably. Prior waves delivered two-step admin transfer, action-specific
pausing, Merkle proof claims, delegates, aggregates, and property-based invariants; these issues
build on that base rather than repeating it.

---

## Issue 1: Manage Storage TTL and Archival for Persistent Contract State
**Labels:** Soroban, Contract, reliability, onchain, architecture
**Complexity:** Hard (200)

**Description**
The contract stores packages, delegates, aggregates, and configuration in persistent storage but
never extends entry TTLs. On Soroban, persistent entries that are not bumped become archived, and
an archived package cannot be read or claimed until it is restored. A long-lived aid package could
therefore become unclaimable purely through inactivity.

Introduce deliberate TTL management for every long-lived storage entry.

**Acceptance Criteria**
- Reads and writes of long-lived entries bump TTL according to a documented policy
- TTL thresholds and extension amounts are defined as named constants
- The policy distinguishes instance, persistent, and temporary storage usage
- Tests assert TTL is extended on the relevant operations
- The archival behaviour and its operational implications are documented

---

## Issue 2: Consolidate the Duplicate Expiry Extension Entry Points
**Labels:** Soroban, Contract, chore, architecture, api
**Complexity:** Medium (150)

**Description**
`lib.rs` exposes two overlapping functions: `extend_expiration(env, package_id, additional_time)`
at line ~1202 and `extend_expiry(env, id, new_expires_at)` at line ~1218. One takes a relative
delta and the other an absolute timestamp, with near-identical names. This is a real footgun for
integrators and doubles the authorization surface that must be audited.

Converge on one canonical entry point with a clear deprecation path.

**Acceptance Criteria**
- A single canonical extension function is chosen and documented
- The redundant function is either removed or clearly marked deprecated with unchanged behaviour
- Backend callers in `app/backend/src/onchain/` are updated to the canonical function
- Tests cover relative and absolute semantics without ambiguity
- The change is noted for the migration/versioning path

---

## Issue 3: Version the Contract Event Schema
**Labels:** Soroban, Contract, versioning, integration, observability
**Complexity:** Medium (150)

**Description**
`app/onchain/contracts/aid_escrow/EVENTS.md` documents the emitted events, but events carry no
schema version. The backend correlates these events in
`app/backend/src/onchain/soroban-event-correlation.service.ts`, so any change to an event's shape
silently breaks correlation for indexers already in flight.

**Acceptance Criteria**
- Emitted events carry an explicit schema version
- `EVENTS.md` records the version and a compatibility policy
- The backend correlation service tolerates known versions and logs unknown ones
- Tests assert the version is present on every emitted event topic
- The versioning rule for future event changes is documented

---

## Issue 4: Add Batch Claim for Multiple Packages
**Labels:** Soroban, Contract, feature, performance, onchain
**Complexity:** Hard (200)

**Description**
`batch_create_packages` exists at line ~772, but claiming remains strictly one package per
invocation via `claim` and `claim_with_proof`. A recipient holding several tranche packages must
submit a separate transaction for each, which multiplies fees and is a poor field experience on
mobile.

**Acceptance Criteria**
- A batch claim accepts multiple package ids in one invocation
- Per-package authorization and eligibility are still enforced individually
- Partial success semantics are explicit and documented
- Batch size is bounded to stay within resource limits
- Fund accounting invariants hold, verified by tests including partial-failure cases

---

## Issue 5: Sweep Expired Delegate Authorizations
**Labels:** Soroban, Contract, security, ops, feature
**Complexity:** Medium (150)

**Description**
`set_delegate_with_expiry` (line ~1903) records an expiry, and `get_delegate_info` returns it, but
nothing clears delegates once expired. Expired entries linger in storage, consuming rent and
leaving a misleading delegate visible to any reader that does not itself check the expiry.

**Acceptance Criteria**
- A callable sweep clears expired delegate entries in bounded batches
- `get_delegate` never returns an expired delegate regardless of sweep timing
- Sweeping emits an event per cleared delegate
- Tests cover expired, unexpired, and boundary-time delegates
- The sweep is safe to call repeatedly and by any address

---

## Issue 6: Add Pagination to Recipient Package Listing
**Labels:** Soroban, Contract, performance, api, reliability
**Complexity:** Medium (150)

**Description**
`list_recipient_packages` at line ~1794 returns packages for a recipient. Without pagination, a
recipient with many packages will eventually produce a call that exceeds Soroban's resource
budget, making the function unusable exactly for the heaviest users.

**Acceptance Criteria**
- The function accepts offset/limit or cursor parameters
- A maximum page size is enforced as a named constant
- Total count remains retrievable via `get_recipient_package_count`
- Tests cover empty, single-page, multi-page, and out-of-range requests
- Backend read helpers in `app/backend/src/onchain/contract-read.service.ts` are updated

---

## Issue 7: Add Campaign-Level Pause Controls
**Labels:** Soroban, Contract, feature, admin, governance
**Complexity:** Hard (200)

**Description**
Pausing today is global (`pause`) or per-action (`pause_action`). There is no way to halt activity
for one campaign while others continue. Operationally, a problem is almost always scoped to a
single campaign, so the only available response is far broader than the incident.

**Acceptance Criteria**
- A campaign can be paused and unpaused by the admin
- Claim, disburse, and refund respect campaign pause state
- Campaign pause state is queryable
- Global pause continues to take precedence over campaign state
- Tests cover interaction between global, action, and campaign pause

---

## Issue 8: Anchor Evidence Hashes to Packages Onchain
**Labels:** Soroban, Contract, feature, evidence, onchain, audit
**Complexity:** Hard (200)

**Description**
Verification evidence lives entirely offchain in the backend and AI service. Nothing binds a
package to the evidence that justified it, so an auditor cannot prove after the fact which
evidence supported a disbursement. The backend already carries anchor metadata
(`app/ai-service/schemas/common.py`), but the contract stores no counterpart.

**Acceptance Criteria**
- A package can carry an evidence hash set at creation or attached by an authorized party
- The hash is emitted in an event and readable via a getter
- Attaching evidence is authorized and cannot silently overwrite an existing hash
- Hash format and length are validated
- Tests cover attach, overwrite rejection, and retrieval

---

## Issue 9: Enforce a Per-Recipient Claim Cooldown
**Labels:** Soroban, Contract, security, feature, reliability
**Complexity:** Medium (150)

**Description**
Nothing limits how rapidly one recipient may claim across packages. A compromised recipient key
can drain every package assigned to it in a single ledger, leaving no window for an operator to
notice and pause.

**Acceptance Criteria**
- An optional per-recipient cooldown between claims is enforced
- The cooldown is configurable via `set_config` and may be disabled
- Cooldown rejections produce a distinct, documented error
- Tests cover claims inside and outside the window and the disabled case
- Interaction with batch claim is defined

---

## Issue 10: Stabilize and Export Contract Error Codes
**Labels:** Soroban, Contract, api, devex, integration, documentation
**Complexity:** Medium (150)

**Description**
The contract returns `Result<(), Error>` throughout, but the `Error` variants are not documented
as a stable numbered contract. The backend adapter in
`app/backend/src/onchain/soroban-onchain.adapter.ts` must map failures to user-facing messages,
and without stable codes that mapping breaks whenever a variant is reordered.

**Acceptance Criteria**
- Error variants carry explicit stable discriminants
- A reference table of code, name, and meaning is committed
- Reordering or removing a variant is guarded by a test
- The backend adapter maps codes rather than positions
- The compatibility policy for adding new errors is documented

---

## Issue 11: Require a Timelock for Emergency Surplus Withdrawal
**Labels:** Soroban, Contract, security, governance, admin
**Complexity:** Hard (200)

**Description**
`withdraw_surplus` at line ~1271 lets the admin move surplus funds immediately. A compromised
admin key can therefore extract funds with no observation window, and the two-step admin transfer
added previously does not help because withdrawal is a single step.

**Acceptance Criteria**
- Surplus withdrawal is a propose-then-execute flow with a configurable delay
- A pending withdrawal is queryable and cancellable by the admin
- Executing before the delay elapses fails with a distinct error
- Proposal, cancellation, and execution each emit events
- Tests cover the full lifecycle including boundary timing

---

## Issue 12: Export the Contract Interface for Backend Type Generation
**Labels:** Soroban, Contract, devex, tooling, integration, ci
**Complexity:** Medium (150)

**Description**
The backend hand-maintains request and response types for contract calls under
`app/backend/src/onchain/interfaces/` and `dto/`. Because these are written by hand, they drift
from the Rust source whenever a signature changes, and the drift is only found at runtime on testnet.

**Acceptance Criteria**
- The contract spec is exported to a checked-in machine-readable artifact
- TypeScript types are generated from that artifact
- CI fails when generated types drift from the committed ones
- The generation command is documented for contributors
- At least one backend call site consumes the generated types

---

## Issue 13: Gate Gas and Resource Regressions in CI
**Labels:** Soroban, Contract, performance, ci, testing
**Complexity:** Medium (150)

**Description**
`app/onchain/contracts/aid_escrow/GAS_PROFILING_REPORT.md` and
`tests/gas_profiling.rs` capture resource usage, but nothing fails a pull request that makes a hot
path materially more expensive. Cost regressions therefore reach testnet unnoticed.

**Acceptance Criteria**
- Committed budgets exist for the main entry points
- CI fails when measured usage exceeds a budget beyond an allowed tolerance
- The failure message names the function and the delta
- Budgets can be updated deliberately in a reviewed commit
- The workflow tolerates normal measurement noise

---

## Issue 14: Add Batch Revoke and Batch Refund
**Labels:** Soroban, Contract, feature, ops, performance
**Complexity:** Medium (150)

**Description**
`batch_create_packages` allows bulk creation, but unwinding is single-package only via `revoke`
(line ~1055) and `refund` (line ~1090). Recovering from a bad bulk import therefore takes as many
transactions as the import created, which is slow precisely when speed matters.

**Acceptance Criteria**
- Batch revoke and batch refund accept bounded lists of package ids
- Authorization is checked per package
- Partial success semantics match the batch create convention
- Aggregates and locked/claimed totals stay consistent
- Tests cover partial failure and idempotent re-invocation

---

## Issue 15: Support Reassigning a Package to a New Recipient
**Labels:** Soroban, Contract, feature, product, admin
**Complexity:** Hard (200)

**Description**
A package's recipient is fixed at creation. In the field, recipients are recorded incorrectly or
change household representative, and today the only remedy is revoke plus recreate, which loses
the package's history and its onchain identity.

**Acceptance Criteria**
- An authorized party can reassign an unclaimed package to a new recipient
- Reassignment is rejected for claimed, revoked, or expired packages
- Recipient package counts are updated for both old and new recipients
- An event records the previous and new recipient
- Tests cover permitted and rejected states

---

## Issue 16: Document and Test the Storage Key Layout
**Labels:** Soroban, Contract, architecture, documentation, reliability
**Complexity:** Medium (150)

**Description**
Storage keys are constructed inline throughout `lib.rs` and `delegate.rs`. There is no single
reference describing the key space, which makes accidental collisions plausible as contributors add
features and makes the `migrate` path (line ~417) difficult to reason about.

**Acceptance Criteria**
- A committed document describes every storage key, its type, and its lifetime
- Key construction is centralized in one module
- A test asserts no two key constructors can collide for distinct inputs
- The document states which keys a migration must consider
- The reference is linked from the contract README

---

## Issue 17: Sweep Expired Packages and Release Locked Funds
**Labels:** Soroban, Contract, feature, ops, onchain
**Complexity:** Hard (200)

**Description**
Packages that pass their expiry without being claimed keep their funds counted as locked. The
existing test snapshot `auto_expires_package_status_on_late_claim` shows status resolves lazily on
access, so a package nobody touches holds funds indefinitely and `get_total_locked` overstates
committed balance.

**Acceptance Criteria**
- A callable sweep transitions expired packages to a terminal state in bounded batches
- Locked totals and aggregates are corrected as packages are swept
- Sweeping is idempotent and callable by any address
- An event is emitted per swept package
- Tests assert `get_total_locked` accuracy before and after sweeping

---

## Issue 18: Add Per-Campaign Multi-Token Accounting
**Labels:** Soroban, Contract, feature, data-model, onchain
**Complexity:** Hard (200)

**Description**
`get_total_locked` and `get_total_claimed` are keyed by token, and campaign counters
(`get_campaign_package_count`, `get_campaign_claim_count`) count packages without regard to token.
There is no way to ask what a campaign holds or has disbursed in a given token, which is exactly
what a funder reconciling a multi-token campaign needs.

**Acceptance Criteria**
- Locked and claimed totals are queryable per campaign and token pair
- Counters update on fund, claim, disburse, refund, and revoke
- Existing token-level and campaign-level getters keep their current behaviour
- Invariant tests assert campaign totals sum to token totals
- The migration path for existing campaign data is defined

---

## Issue 19: Bound and Audit Distributor Role Growth
**Labels:** Soroban, Contract, security, admin, governance
**Complexity:** Medium (150)

**Description**
`add_distributor` (line ~442) and `remove_distributor` (line ~463) manage the distributor set, but
there is no way to enumerate current distributors and no cap on set size. An admin cannot audit who
holds distribution rights, and the set can grow until iteration over it becomes costly.

**Acceptance Criteria**
- The current distributor set is enumerable, with pagination if unbounded
- A configurable maximum set size is enforced
- Adding a duplicate distributor is a documented no-op or explicit error
- Add and remove emit events carrying the resulting set size
- Tests cover the cap, duplicates, and enumeration

---

## Issue 20: Add a Configurable Platform Fee on Disbursement
**Labels:** Soroban, Contract, feature, product, data-model
**Complexity:** Hard (200)

**Description**
All funding flows entirely to recipients, with no mechanism to retain a fee for operational costs.
Real deployments need this, and retrofitting fee handling after packages exist onchain is
considerably harder than designing it into the accounting now.

**Acceptance Criteria**
- An optional fee in basis points is set through `set_config` and defaults to zero
- The fee is applied on disbursement and accrues to a configured collector address
- Rounding behaviour is explicit and documented
- Fee accrual is queryable and withdrawable only by the collector
- Invariant tests assert fees plus disbursed amounts never exceed funded amounts

---
