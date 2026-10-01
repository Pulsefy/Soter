# AidEscrow Callable Interface

This is the caller-facing reference for every public entry point exported by
`src/lib.rs`. Signatures omit Soroban's injected `env: Env`; parameter and
return types otherwise match the Rust contract. Amounts are positive integers
in token base units. See [`EVENTS.md`](./EVENTS.md) for event payloads and topic
stability, and [`VERSIONING.md`](./VERSIONING.md) for migration policy.

## Calling conventions

- A listed `Error` is a contract error returned by the function. An
  `Address::require_auth()` failure is a Soroban authorization failure and may
  abort invocation rather than return `Error::NotAuthorized`.
- Functions that call `get_admin` may return `Error::NotInitialized` if the
  contract has not been initialized. Authorization-check ordering varies by
  entry point; functions with an explicit signer may fail authorization first.
  Functions that read defaults or empty storage may instead return their
  documented default.
- Unless a row says otherwise, `Events` is `none`. Read-only calls do not emit
  events. A conditional event is emitted only when its described state change
  occurs. Event topic names in the tables are the exact catalog keys in
  [`EVENTS.md`](./EVENTS.md#event-catalog).
- `global + action` means both the global pause and the named action pause
  block the call with `Error::ContractPaused`. Campaign-gated calls are also
  blocked by global pause and by the package's `campaign_ref` pause. A package
  without `campaign_ref` is not gated by campaign state.

## Administration, versioning, and distributors

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `init` | `admin: Address` -> `Result<(), Error>` | None; callable once. | `AlreadyInitialized` | No pause gate; none. |
| `get_admin` | none -> `Result<Address, Error>` | Public. | `NotInitialized` | None. |
| `get_pending_admin` | none -> `Option<Address>` | Public. `None` if no transfer is pending. | None | None. |
| `transfer_admin` | `new_admin: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `InvalidPendingAdmin` (new address is current admin). | No pause gate; `admin_transfer_initiated`. |
| `accept_admin` | none -> `Result<(), Error>` | Pending admin must authorize. | `NoPendingTransfer` | No pause gate; `admin_transfer_accepted`. |
| `cancel_admin_transfer` | none -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NoPendingTransfer` | No pause gate; `admin_transfer_cancelled`. |
| `get_version` | none -> `u32` | Public. Returns `0` if not initialized. | None | None. |
| `contract_version` | none -> `String` | Public. Semantic package version string. | None | None. |
| `migrate` | `new_version: u32` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized` | No pause gate; none. Version `1 -> 2` backfills per-campaign token totals; other versions currently only update the stored version. |
| `add_distributor` | `addr: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `DistributorAlreadyExists`, `DistributorSetFull` | No pause gate; `distributor_added`. Distributors may create packages, but cannot perform admin operations. |
| `remove_distributor` | `addr: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `DistributorNotFound` | No pause gate; `distributor_removed`. |
| `get_distributor_count` | none -> `u32` | Public. | None | None. |
| `is_distributor` | `addr: Address` -> `bool` | Public. | None | None. |
| `list_distributors` | `cursor: u32, limit: u32` -> `Vec<Address>` | Public; no admin check. `limit` is capped at 50; an out-of-range cursor returns an empty vector. | None | None. |
| `get_max_distributors` | none -> `u32` | Public. Defaults to 100. | None | None. |
| `set_max_distributors` | `max: u32` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `InvalidAmount` (`max == 0`) | No pause gate; none. Lowering the cap does not remove existing distributors. |

## Configuration and pauses

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `set_config` | `config: Config` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `InvalidAmount` (`min_amount <= 0`), `InvalidToken` | No pause gate; none. `Config` includes `min_amount`, `max_expires_in`, `allowed_tokens`, and `claim_cooldown`. |
| `get_config` | none -> `Config` | Public. Defaults: min amount 1, no expiry cap, empty token list, cooldown 0. | None | None. |
| `pause` | none -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized` | No pause gate; `contract_paused_event`. |
| `unpause` | none -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized` | No pause gate; `contract_unpaused_event`. |
| `is_paused` | none -> `bool` | Public. Reports only global pause state. | None | None. |
| `pause_action` | `action: Symbol` -> `Result<(), Error>` | Current admin must authorize. Valid actions: `create`, `claim`, `withdraw`, `refund`. | `NotInitialized`, `InvalidState` (unknown action) | No pause gate; `action_paused_event`. |
| `unpause_action` | `action: Symbol` -> `Result<(), Error>` | Current admin must authorize. Valid actions: `create`, `claim`, `withdraw`, `refund`. | `NotInitialized`, `InvalidState` (unknown action) | No pause gate; `action_unpaused_event`. |
| `is_action_paused` | `action: Symbol` -> `bool` | Public. Global pause makes this true. Unknown actions return false if not globally paused. | None | None. |
| `pause_campaign` | `campaign_ref: String` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized` | No pause gate; `campaign_paused_event`. Blocks claims, disbursements, and refunds for matching packages. |
| `unpause_campaign` | `campaign_ref: String` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized` | No pause gate; `campaign_unpaused_event`. |
| `is_campaign_paused` | `campaign_ref: String` -> `bool` | Public. Returns true for a matching campaign pause or global pause. | None | None. |

## Funding and package lifecycle

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `fund` | `token: Address, from: Address, amount: i128` -> `Result<(), Error>` | `from` must authorize the token transfer. | `InvalidAmount`, `InvalidToken`, `TokenTransferFailed` | No pause gate; `escrow_funded`. Amount must be positive and an integer whole token unit at the token's reported precision. |
| `create_package` | `operator: Address, id: u64, recipient: Address, amount: i128, token: Address, expires_at: u64, metadata: Map<Symbol, String>` -> `Result<u64, Error>` | `operator` must authorize and be current admin or registered distributor. | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `InvalidAmount`, `InvalidToken`, `InvalidState`, `PackageIdExists`, `InsufficientFunds` | Global + `create`; `package_created`. `expires_at` is an absolute ledger timestamp; 0 means no expiry unless configuration imposes a maximum. |
| `batch_create_packages` | `operator: Address, recipients: Vec<Address>, amounts: Vec<i128>, token: Address, expires_in: u64, metadatas: Vec<Map<Symbol, String>>` -> `Result<Vec<u64>, Error>` | `operator` must authorize and be current admin or registered distributor. | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `MismatchedArrays`, `InvalidAmount`, `InvalidToken`, `InvalidState`, `InsufficientFunds` | Global + `create`; one `package_created` per success plus one `batch_created_event`. `expires_in` is seconds from now; arrays must have equal lengths. |
| `claim` | `id: u64` -> `Result<(), Error>` | Stored recipient must authorize. | `ContractPaused`, `PackageNotFound`, `PackageNotActive`, `ClaimTooEarly`, `PackageExpired`, `InvalidProof` (Merkle-gated package), `ClaimCooldownActive`, `TokenTransferFailed` | Global + `claim` + campaign; `package_claimed`. For Merkle-gated packages use `claim_with_proof`. |
| `claim_with_proof` | `id: u64, claimant: Address, proof: Vec<String>` -> `Result<(), Error>` | `claimant` must authorize and be the recipient or active delegate for a non-Merkle package; for a Merkle package the proof must authorize claimant. | `ContractPaused`, `PackageNotFound`, `PackageNotActive`, `ClaimTooEarly`, `PackageExpired`, `InvalidProof`, `NotAuthorized`, `ClaimCooldownActive`, `TokenTransferFailed` | Global + `claim` + campaign; `package_claimed`; a claimant address different from the package recipient also emits `delegate_claimed` and `delegate_revoked` (including a Merkle-authorized claimant). Proof sibling values are hex-encoded 32-byte hashes for the claimant-address leaf. |
| `claim_with_relayer` | `id: u64, claimant: Address, relayer: Address` -> `Result<(), Error>` | Both claimant and relayer must authorize; claimant must be recipient or active delegate. | `ContractPaused`, `PackageNotFound`, `PackageNotActive`, `ClaimTooEarly`, `PackageExpired`, `InvalidProof` (Merkle packages cannot use this path), `NotAuthorized`, `ClaimCooldownActive`, `TokenTransferFailed` | Global + `claim` + campaign; `package_claimed_by_relayer`. |
| `batch_claim` | `claimant: Address, ids: Vec<u64>` -> `Result<Vec<BatchClaimResult>, Error>` | Claimant authorizes once; each item independently checks recipient/delegate eligibility. | Outer errors: `ContractPaused`, `BatchTooLarge` (>25). Ineligible items are returned as `ClaimStatus`, not outer errors. | Global + `claim`; each successful item emits `package_claimed` and delegate events when applicable. |
| `disburse` | `id: u64` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `ContractPaused`, `TokenTransferFailed` | Campaign gate (also blocked by global pause); `package_disbursed`. Does not require the recipient to claim. |
| `reassign_package` | `package_id: u64, new_recipient: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `PackageExpired` | No pause gate; `package_reassigned`. Only `Created`, unexpired packages can be reassigned. |
| `batch_revoke` | `ids: Vec<u64>` -> `Result<Vec<BatchAdminActionResult>, Error>` | Current admin must authorize once. | Outer errors: `NotInitialized`, `NotAuthorized`, `BatchTooLarge` (>25). Per-item results use `BatchAdminActionStatus`. | No pause gate; `package_revoked` for each success. |
| `batch_refund` | `ids: Vec<u64>` -> `Result<Vec<BatchAdminActionResult>, Error>` | Current admin must authorize once. | Outer errors: `ContractPaused`, `NotInitialized`, `NotAuthorized`, `BatchTooLarge` (>25). Per-item results use `BatchAdminActionStatus`. | Global + `refund`, plus campaign gate per package; `package_refunded` for each success. |
| `revoke` | `id: u64` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `InvalidState` (not `Created`) | No pause gate; `package_revoked`. Unlocks funds back into the pool. |
| `refund` | `id: u64` -> `Result<(), Error>` | Current admin must authorize. | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `InvalidState`, `TokenTransferFailed` | Global + `refund` + campaign; `package_refunded`. A created package is refundable only after expiry; cancelled or expired packages may be refunded. |
| `cancel_package` | `package_id: u64` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `PackageExpired` | No pause gate; `package_revoked`. Cancels an unexpired `Created` package and unlocks its funds. |
| `attach_evidence_hash` | `admin: Address, package_id: u64, evidence_hash: String` -> `Result<(), Error>` | `admin` must authorize and equal current admin. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `InvalidState` (hash is not 64 hex characters or one is already attached) | No pause gate; `evidence_attached`. |
| `extend_expiration` | `package_id: u64, additional_time: u64` -> `Result<(), Error>` | Delegates to `extend_expiry`; current admin must authorize there. | `InvalidAmount` (zero delta), `PackageNotFound`, `InvalidState` (unbounded expiry), plus `extend_expiry` errors. | No pause gate; emits `extended_event` via `extend_expiry`. **Deprecated:** use `extend_expiry` with an absolute timestamp for new integrations. |
| `extend_expiry` | `id: u64, new_expires_at: u64` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `PackageNotFound`, `PackageNotActive`, `PackageExpired`, `InvalidState` | No pause gate; `extended_event`. Absolute new expiry must be later than the old expiry and satisfy the configured maximum. |

### Batch result values

`batch_claim` returns one `BatchClaimResult { package_id, status,
amount }` for each input ID. `ClaimStatus` is `Success`, `NotFound`,
`NotActive`, `ClaimTooEarly`, `Expired`, `RequiresProof`, `Unauthorized`,
`CampaignPaused`, `TransferFailed`, or `CooldownActive`. Amount is zero unless
successful. A failure on one ID does not abort other claims.

`batch_revoke` and `batch_refund` return one
`BatchAdminActionResult { package_id, status, amount }` per ID. Status is
`Success`, `NotFound`, `InvalidState`, `Expired`, `NotExpired`,
`CampaignPaused`, or `TransferFailed`; amount is zero unless successful.
Batch refund transfers successful package amounts to the admin.

## Surplus withdrawals

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `propose_surplus_withdrawal` | `to: Address, amount: i128, token: Address` -> `Result<(), Error>` | Current admin must authorize. | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `InvalidAmount`, `InvalidToken`, `InsufficientSurplus`, `SurplusWithdrawalPending` | Global + `withdraw`; `surplus_withdrawal_proposed`. Starts an 86,400-second timelock; only one proposal may be pending. |
| `cancel_surplus_withdrawal` | none -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `SurplusWithdrawalNotPending` | No pause gate; `surplus_withdrawal_cancelled`. |
| `execute_surplus_withdrawal` | none -> `Result<(), Error>` | Current admin must authorize. | `ContractPaused`, `NotInitialized`, `NotAuthorized`, `SurplusWithdrawalNotPending`, `SurplusWithdrawalTimelockActive`, `InvalidToken`, `InsufficientSurplus`, `TokenTransferFailed` | Global + `withdraw`; `surplus_withdrawn_event`. Rechecks available surplus at execution time. |
| `get_pending_withdrawal` | none -> `Option<PendingWithdrawal>` | Public. | None | None. |

## Package and aggregate views

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `get_total_locked` | `token: Address` -> `i128` | Public. Zero if none. | None | None. |
| `get_total_claimed` | `token: Address` -> `i128` | Public. Cumulative recipient-initiated claim total; excludes admin `disburse`. | None | None. |
| `get_campaign_token_locked` | `campaign_ref: String, token: Address` -> `i128` | Public. Zero if none. | None | None. |
| `get_campaign_token_claimed` | `campaign_ref: String, token: Address` -> `i128` | Public. Same claim-only semantics as `get_total_claimed`. | None | None. |
| `get_package` | `id: u64` -> `Result<Package, Error>` | Public. Returns full stored package. | `PackageNotFound` | None. |
| `view_package_status` | `id: u64` -> `Result<PackageStatus, Error>` | Public. | `PackageNotFound` | None. |
| `get_evidence_hash` | `id: u64` -> `Result<String, Error>` | Public. Empty string if unattached. | `PackageNotFound` | None. |
| `get_aggregates` | `token: Address` -> `Aggregates` | Public. Scans package records. `total_claimed` counts every package in `Claimed` status, including disbursements. | None | None. |
| `get_campaign_package_count` | `campaign_ref: String` -> `u64` | Public. Counts stored packages with matching metadata. | None | None. |
| `get_campaign_claim_count` | `campaign_ref: String` -> `u64` | Public. Counts matching packages in `Claimed` status, including disbursements. | None | None. |
| `get_recipient_package_count` | `recipient: Address` -> `u64` | Public. Counts stored packages currently assigned to recipient. | None | None. |
| `list_recipient_packages` | `recipient: Address, cursor: u64, limit: u32` -> `Vec<u64>` | Public. Scans package ID positions from cursor; limit is capped at 50 and out-of-range cursor returns empty. | None | None. |

`Package` contains `id`, `recipient`, `amount`, `token`, `status`,
`created_at`, `expires_at`, `claim_starts_at`, `metadata`, and
`evidence_hash`. `PackageStatus` is `Created`, `Claimed`, `Expired`,
`Cancelled`, or `Refunded`. `Config`, `Aggregates`, and `PendingWithdrawal`
fields are defined in `src/lib.rs` and serialized as Soroban contract types.

## Delegates and token allowlist

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `set_delegate` | `admin: Address, package_id: u64, delegate: Address` -> `Result<(), Error>` | The supplied `admin` address must authorize. **Current implementation does not compare it with the stored admin**, so this is not enforced as an admin role check. | `PackageNotFound`, `PackageNotActive` (already claimed), `InvalidState` (delegate equals recipient) | No pause gate; `delegate_added`. |
| `set_delegate_with_expiry` | `admin: Address, package_id: u64, delegate: Address, expires_at: u64` -> `Result<(), Error>` | Same supplied-address authorization and missing stored-admin comparison as `set_delegate`. | `PackageNotFound`, `PackageNotActive` (already claimed), `InvalidState` (delegate equals recipient or expiry is not in the future) | No pause gate; `delegate_added`. `expires_at == 0` does not set a new expiry; when updating a delegate that already has an expiry, the current implementation retains that stored expiry. |
| `revoke_delegate` | `admin: Address, package_id: u64` -> `Result<(), Error>` | Supplied `admin` address must authorize; implementation does not compare it with stored admin. | `PackageNotFound` | No pause gate; `delegate_revoked` only if a delegate existed. |
| `get_delegate` | `package_id: u64` -> `Option<Address>` | Public. Returns `None` if unset or expired. | None | None. |
| `get_delegate_info` | `package_id: u64` -> `Option<(Address, Option<u64>)>` | Public. Includes optional expiry; expired delegate returns `None`. | None | None. |
| `get_delegate_history` | `package_id: u64` -> `Vec<DelegateHistory>` | Public. Empty if no history. | None | None. |
| `cleanup_expired_delegates` | `admin: Address` -> `Result<u32, Error>` | Supplied address must authorize; current wrapper does not compare it with stored admin and does not use it for cleanup. | None currently returned by implementation. | No pause gate; emits `delegate_revoked` per expired delegate cleared. Fixed sweep cap is 100. |
| `sweep_expired_delegates` | `limit: u32` -> `Result<u32, Error>` | Public; no authorization required. | None currently returned by implementation. | No pause gate; emits `delegate_revoked` per expired delegate cleared. `0` means 50; other values are capped at 100. |
| `add_allowed_token` | `token: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `InvalidToken`, `InvalidState` (already allowed) | No pause gate; `token_added`. |
| `remove_allowed_token` | `token: Address` -> `Result<(), Error>` | Current admin must authorize. | `NotInitialized`, `NotAuthorized`, `InvalidState` (not currently allowed) | No pause gate; `token_removed`. |

## Permissionless expiry maintenance

| Entry point | Parameters -> return | Authorization | Errors | Pause / events |
| --- | --- | --- | --- | --- |
| `sweep_expired_packages` | `limit: u32` -> `Result<u32, Error>` | Public; no authorization required. | None currently returned by implementation. | No pause gate; emits one `package_swept` per changed package. `limit == 0` means 50; otherwise capped at 100. Only `Created` packages strictly past nonzero expiry are swept. |

## Pause coverage summary

| Pause layer | Affected entry points |
| --- | --- |
| Global + action `create` | `create_package`, `batch_create_packages` |
| Global + action `claim` | `claim`, `claim_with_proof`, `claim_with_relayer`, `batch_claim` |
| Global + action `refund` | `refund`, `batch_refund` |
| Global + action `withdraw` | `propose_surplus_withdrawal`, `execute_surplus_withdrawal` |
| Global + campaign | `claim`, `claim_with_proof`, `claim_with_relayer`, `disburse`, `refund`, and each `batch_refund` item |
| No pause check | All other entry points, including `fund`, `revoke`, `cancel_package`, and `batch_revoke` |

`pause_campaign` itself describes campaign pause as covering claim,
disbursement, and refund. The entry points listed above check campaign state
directly; create, revoke, cancellation, and reassignment do not.
