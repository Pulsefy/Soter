# AidEscrow Event Schema (Indexer Reference)

This document is the canonical reference for the on-chain events emitted by the
`aid_escrow` contract. It is written for **backend indexers** that consume
Soroban contract events on Testnet (and later Mainnet) and need a stable,
reviewed description of every event topic and payload.

It also records the outcome of the event-schema audit requested for Testnet
readiness: an enumeration of every emitted event, a review of identifier
stability, and a check that payloads do not leak sensitive metadata.

## Stability contract

Events are defined in `src/lib.rs` under the
`// --- Contract Events (indexer-friendly; stable topics & payloads) ---`
section using the `#[contractevent]` derive.

- **Topic** = the event struct name converted to `snake_case`
  (e.g. `PackageCreated` -> `package_created`).
- Topics and payload field names/types are a **public interface**. Do not
  rename or reorder fields without a contract version bump. See
  [`VERSIONING.md`](./VERSIONING.md) and `get_version()` / `migrate()`.
- All monetary `amount` values are integers in the token's base units
  (stroops for the 7-decimal native asset), never fractional "human" units.
- All `timestamp` values are the ledger close time in Unix seconds
  (`env.ledger().timestamp()`).

## Event Schema Versioning

### Current Version
- **Schema Version**: `1` (defined as `EVENT_SCHEMA_VERSION` constant in `src/lib.rs`)
- **Introduced**: Initial schema versioning implementation

### Compatibility Policy
- **Backward Compatibility**: Indexers should tolerate events with known schema versions (currently version 1). Events with unknown schema versions should be logged but not cause correlation failures.
- **Version Changes**: Incrementing `EVENT_SCHEMA_VERSION` indicates a backward-incompatible change to event payloads. Indexers must be updated to handle the new version before deployment.
- **Field Additions**: Adding optional fields to existing events is backward-compatible and does not require a schema version increment.
- **Field Removal/Renaming**: Removing or renaming fields requires a schema version increment.
- **Type Changes**: Changing field types requires a schema version increment.

### Version Field
All events include a `schema_version: u32` field as the first field in the payload. Indexers should:
1. Extract and validate the `schema_version` field from every event
2. Compare against their known/expected versions
3. Log warnings for unknown versions
4. Skip or defer processing of events with unknown versions

### Future Versioning Rules
When making event schema changes:
1. Increment `EVENT_SCHEMA_VERSION` constant in `src/lib.rs`
2. Update this EVENTS.md with the new version number and changes
3. Document the specific changes that necessitated the version bump
4. Ensure backend correlation service is updated to handle the new version
5. Run tests to verify version field is present on all events

## Event catalog

| Topic | Emitted by | When |
| --- | --- | --- |
| `escrow_funded` | `fund` | Pool receives a token transfer from a funder. |
| `package_created` | `create_package`, `batch_create_packages` | One event per created package. |
| `batch_created_event` | `batch_create_packages` | Summary of a batch creation. |
| `package_reassigned` | `reassign_package` | Admin changes an unclaimed package recipient. |
| `package_claimed` | `claim`, `claim_with_proof`, successful `batch_claim` items | Recipient or delegate claims a package. |
| `package_claimed_by_relayer` | `claim_with_relayer` | A relayer submits a recipient/delegate claim. |
| `package_disbursed` | `disburse` | Admin disburses a package to its recipient. |
| `package_revoked` | `revoke`, `cancel_package`, successful `batch_revoke` items | Admin cancels a `Created` package and unlocks its funds. |
| `package_refunded` | `refund`, successful `batch_refund` items | Admin refunds an expired or cancelled package. |
| `package_swept` | `sweep_expired_packages` | Expired `Created` package becomes terminal `Expired`; locked funds are released. |
| `extended_event` | `extend_expiry` (also deprecated `extend_expiration`) | Admin extends a package expiry. |
| `surplus_withdrawal_proposed` | `propose_surplus_withdrawal` | Admin proposes a withdrawal and starts the timelock. |
| `surplus_withdrawal_cancelled` | `cancel_surplus_withdrawal` | Admin cancels a pending withdrawal proposal. |
| `surplus_withdrawn_event` | `execute_surplus_withdrawal` | Timelocked surplus is transferred to its destination. |
| `contract_paused_event` | `pause` | Admin pauses the whole contract. |
| `contract_unpaused_event` | `unpause` | Admin unpauses the whole contract. |
| `action_paused_event` | `pause_action` | Admin pauses one supported action. |
| `action_unpaused_event` | `unpause_action` | Admin unpauses one action. |
| `campaign_paused_event` | `pause_campaign` | Admin pauses a campaign identified by `campaign_ref`. |
| `campaign_unpaused_event` | `unpause_campaign` | Admin unpauses a campaign. |
| `delegate_added` | `set_delegate`, `set_delegate_with_expiry` | Admin-supplied address registers or updates a package delegate. |
| `delegate_revoked` | `revoke_delegate`, claims by delegates, `sweep_expired_delegates`, `cleanup_expired_delegates` | A delegate is removed, expires, or is cleared after claim. Emission is conditional where noted in the callable interface. |
| `delegate_claimed` | Delegate claim via `claim` or `claim_with_proof` | Delegate claims on behalf of the package recipient. |
| `admin_transfer_initiated` | `transfer_admin` | Current admin nominates a pending admin. |
| `admin_transfer_accepted` | `accept_admin` | Pending admin accepts the role. |
| `admin_transfer_cancelled` | `cancel_admin_transfer` | Current admin cancels a pending transfer. |
| `token_added` | `add_allowed_token` | Admin adds a token to the configured allowlist. |
| `token_removed` | `remove_allowed_token` | Admin removes a token from the configured allowlist. |
| `distributor_added` | `add_distributor` | Admin grants distributor privileges. |
| `distributor_removed` | `remove_distributor` | Admin revokes distributor privileges. |
| `evidence_attached` | `attach_evidence_hash` | Admin attaches an evidence hash to a package. |

> Function names refer to the public entrypoints in `src/lib.rs`.

## Payloads

The six package lifecycle events share one shape (`PackageCreated`,
`PackageClaimed`, `PackageDisbursed`, `PackageRevoked`, `PackageRefunded`,
`PackageSwept`):

| Field           | Type      | Notes                                             |
| --------------- | --------- | ------------------------------------------------- |
| `schema_version` | `u32`     | Event schema version (current: 1).                 |
| `package_id`    | `u64`     | Stable primary key for the package.               |
| `recipient`     | `Address` | Intended recipient of the package.                |
| `amount`        | `i128`    | Package amount in token base units.               |
| `actor`         | `Address` | Account that performed the action (funder/admin). |
| `timestamp`     | `u64`     | Ledger close time (Unix seconds).                 |

Package lifecycle events with additional fields:

| Event              | Payload                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PackageClaimed`    | `schema_version: u32`, `package_id: u64`, `recipient: Address`, `amount: i128`, `actor: Address`, `timestamp: u64`, `receipt_hash: String` |
| `PackageDisbursed` | `schema_version: u32`, `package_id: u64`, `recipient: Address`, `amount: i128`, `actor: Address`, `timestamp: u64`, `receipt_hash: String` |

Pool / administrative events:

| Event                   | Payload                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `EscrowFunded`          | `schema_version: u32`, `from: Address`, `token: Address`, `amount: i128`, `timestamp: u64`         |
| `BatchCreatedEvent`     | `schema_version: u32`, `ids: Vec<u64>`, `admin: Address`, `total_amount: i128`                     |
| `ExtendedEvent`         | `schema_version: u32`, `package_id: u64`, `admin: Address`, `old_expires_at: u64`, `new_expires_at: u64` |
| `SurplusWithdrawnEvent` | `schema_version: u32`, `to: Address`, `token: Address`, `amount: i128`                             |
| `ContractPausedEvent`   | `schema_version: u32`, `admin: Address`                                                            |
| `ContractUnpausedEvent` | `schema_version: u32`, `admin: Address`                                                            |
| `ActionPausedEvent`     | `schema_version: u32`, `admin: Address`, `action: Symbol`                                          |
| `ActionUnpausedEvent`   | `schema_version: u32`, `admin: Address`, `action: Symbol`                                          |
| `CampaignPausedEvent`   | `schema_version: u32`, `admin: Address`, `campaign_ref: String`                                    |
| `CampaignUnpausedEvent` | `schema_version: u32`, `admin: Address`, `campaign_ref: String`                                    |
| `PackageReassigned`     | `schema_version: u32`, `package_id: u64`, `previous_recipient: Address`, `new_recipient: Address`, `actor: Address`, `timestamp: u64` |

Delegate events:

| Event               | Payload                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DelegateAdded`     | `schema_version: u32`, `package_id: u64`, `recipient: Address`, `delegate: Address`, `actor: Address`, `expires_at: u64`, `timestamp: u64` |
| `DelegateRevoked`   | `schema_version: u32`, `package_id: u64`, `recipient: Address`, `delegate: Address`, `actor: Address`, `timestamp: u64`             |
| `DelegateClaimed`   | `schema_version: u32`, `package_id: u64`, `recipient: Address`, `delegate: Address`, `amount: i128`, `actor: Address`, `timestamp: u64` |

Admin transfer events:

| Event                    | Payload                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `AdminTransferInitiated` | `schema_version: u32`, `admin: Address`, `pending_admin: Address`, `timestamp: u64`     |
| `AdminTransferAccepted`  | `schema_version: u32`, `admin: Address`, `timestamp: u64`                             |
| `AdminTransferCancelled` | `schema_version: u32`, `admin: Address`, `timestamp: u64`                             |

Token management events:

| Event        | Payload                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `TokenAdded`   | `schema_version: u32`, `admin: Address`, `token: Address`, `timestamp: u64`   |
| `TokenRemoved` | `schema_version: u32`, `admin: Address`, `token: Address`, `timestamp: u64`   |

Distributor management events:

| Event               | Payload                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `DistributorAdded`   | `schema_version: u32`, `admin: Address`, `distributor: Address`, `total_distributors: u32`, `timestamp: u64` |
| `DistributorRemoved` | `schema_version: u32`, `admin: Address`, `distributor: Address`, `total_distributors: u32`, `timestamp: u64` |

Evidence events:

| Event             | Payload                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `EvidenceAttached` | `schema_version: u32`, `package_id: u64`, `admin: Address`, `evidence_hash: String`, `timestamp: u64` |

## Identifier stability (audit)

- Every package lifecycle event carries `package_id` (`u64`), which is the
  stable key indexers should use to correlate a package across its
  `created -> claimed | disbursed | revoked | refunded | swept` lifecycle.
- Batch creation emits one `package_created` per package **and** a single
  `batch_created_event` whose `ids` array lists exactly those `package_id`s.
  Indexers can rely on either signal; the individual `package_created` events
  are authoritative per-package, and `batch_created_event.ids` gives the batch
  grouping.
- `ExtendedEvent` uses the field name `id` (not `package_id`) for the package
  key; it is the same identifier. This naming difference is intentional to
  document here rather than change, since renaming is a breaking interface
  change (see "Naming observations").

## Sensitive-metadata review (audit)

Packages carry an arbitrary `metadata: Map<Symbol, String>` (used for values
such as `campaign_ref`). **No package lifecycle event payload includes this
map or any value from it.** Events expose only structural fields (ids,
addresses, amounts, timestamps), so free-form or potentially sensitive
package metadata is never leaked through the event stream.

The one exception is `CampaignPausedEvent` / `CampaignUnpausedEvent`, whose
`campaign_ref` field is not incidental package metadata but the admin's own
call argument to `pause_campaign` / `unpause_campaign` — the same value is
already public as the transaction input, so echoing it in the event is not a
metadata leak.

Consequences for indexers:

- Campaign attribution is **not** available from events. To count or group by
  `campaign_ref`, use the read-only view helpers `get_campaign_package_count`
  and `get_campaign_claim_count`, or index the package records directly.
- If campaign attribution is later required in the event stream, add a
  dedicated, non-sensitive field (e.g. a hashed or explicitly public
  `campaign_ref`) behind a version bump rather than emitting the raw metadata
  map.

## Naming observations (non-breaking; for future versioning)

The topic set is not perfectly uniform: lifecycle events use bare nouns
(`package_created`), while several administrative events keep an `_event`
suffix (`batch_created_event`, `surplus_withdrawn_event`, `contract_paused_event`,
etc.), and `ExtendedEvent` uses `id` instead of `package_id`. These are called
out so indexers match the exact topics above. Normalizing them would be a
breaking change and should be deferred to a future contract version, not made
as part of this audit.

## Consistency verification

The contract ships a Soroban `test_snapshots/` suite (under this crate) whose
JSON snapshots capture full ledger output, including emitted events, for the
create / claim / boundary scenarios. Because snapshots are regenerated and
diffed on every `cargo test` run, any accidental change to an event topic or
payload shape shows up as a snapshot diff in CI.

Recommended assertions when adding new event-emitting behavior:

1. After the action, read `env.events().all()` and assert the expected topic is
   present exactly once.
2. Assert the decoded payload fields match the inputs (e.g. `package_id`,
   `amount`, `recipient`).
3. Regenerate and commit the affected `test_snapshots/*.json` so the snapshot
   diff stays authoritative.
4. **New**: Assert that the `schema_version` field is present and matches the expected version.
