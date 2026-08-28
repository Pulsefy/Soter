# AidEscrow Event Schema (Indexer Reference)

This document is the canonical reference for the on-chain events emitted by the
`aid_escrow` contract. It is written for **backend indexers** that consume
Soroban contract events on Testnet (and later Mainnet) and need a stable,
reviewed description of every event topic and payload.

It also records the outcome of the event-schema audit requested for Testnet
readiness: an enumeration of every emitted event, a review of identifier
stability, and a check that payloads do not leak sensitive metadata.

## Schema Versioning

**Current Version: 1**

Every event emitted by this contract includes a `schema_version` field (type `u32`) 
that explicitly identifies the event structure version. This enables backward-compatible
event processing as the contract evolves.

### Version History

| Version | Introduced | Breaking Changes | Compatible Changes |
|---------|------------|------------------|-------------------|
| 1       | Initial    | Initial event schema | Added `schema_version` field to all events |

### Compatibility Policy

**Backward Compatibility Promise:**
- Indexers can safely process events from known schema versions
- New schema versions will only be introduced with major contract upgrades
- Field additions are considered compatible changes (old indexers ignore new fields)
- Field removals, renames, or type changes require a new schema version

**Version Support:**
- **Current Version (1):** Fully supported, recommended for all new integrations
- **Future Versions:** Will be documented here with migration guides
- **Unknown Versions:** Indexers should log warnings and apply fallback processing

### Versioning Rules for Future Changes

**Compatible Changes (no version bump required):**
- Adding new optional fields to existing events
- Adding entirely new event types
- Adding new enum values (where backward compatibility is maintained)

**Breaking Changes (require version bump):**
- Removing fields from existing events
- Renaming fields in existing events
- Changing field types (e.g., `u64` to `String`)
- Changing field semantics (e.g., switching from stroops to human units)
- Reordering fields in the event structure

**When to Bump Schema Version:**
1. Increment `EVENT_SCHEMA_VERSION` constant in `src/lib.rs`
2. Update this documentation with changes and migration notes
3. Add version handling to backend correlation service
4. Update tests to verify version presence and correctness

## Stability contract

Events are defined in `src/lib.rs` under the
`// --- Contract Events (indexer-friendly; stable topics & payloads) ---`
section using the `#[contractevent]` derive.

- **Topic** = the event struct name converted to `snake_case`
  (e.g. `PackageCreated` -> `package_created`).
- Topics and payload field names/types are a **public interface**. Do not
  rename or reorder fields without a contract version bump. See
  [`VERSIONING.md`](./VERSIONING.md) and `get_version()` / `migrate()`.
- **Schema Version** = every event includes a `schema_version` field (u32) 
  set to `EVENT_SCHEMA_VERSION` constant (currently 1). Indexers must check
  this field and handle unknown versions gracefully.
- All monetary `amount` values are integers in the token's base units
  (stroops for the 7-decimal native asset), never fractional "human" units.
- All `timestamp` values are the ledger close time in Unix seconds
  (`env.ledger().timestamp()`).

## Universal Fields

Every event emitted by this contract includes these common fields:

| Field           | Type   | Description                                |
|-----------------|--------|--------------------------------------------|
| `schema_version`| `u32`  | Event structure version (currently 1)     |
| `timestamp`     | `u64`  | Ledger close time in Unix seconds         |

## Event catalog

| Topic                     | Emitted by          | When                                                   |
| ------------------------- | ------------------- | ------------------------------------------------------ |
| `escrow_funded`           | `fund`              | Pool is funded by a funder.                            |
| `package_created`         | `create_package`    | A single aid package is created (funds locked).        |
| `package_created` (xN)    | batch create        | One per package created in a batch (see below).        |
| `batch_created_event`     | batch create        | Summary event for a batch creation.                    |
| `package_reassigned`      | `reassign_package`  | Admin changes an unclaimed package recipient.         |
| `package_claimed`         | claim path          | Recipient claims a package (incl. Merkle-proof claim). |
| `package_disbursed`       | `disburse`          | Admin disburses a package to its recipient.            |
| `package_revoked`         | `revoke`            | Admin revokes a `Created` package (funds unlocked).    |
| `package_refunded`        | `refund`            | Admin refunds an expired/cancelled package.            |
| `package_swept`           | `sweep_expired_packages` | Sweep transitions an expired `Created` package to terminal `Expired` (funds released from locked). |
| `extended_event`          | `extend_expiration` | Admin extends a package expiry.                        |
| `surplus_withdrawn_event` | `withdraw_surplus`  | Admin withdraws unallocated surplus from the pool.     |
| `contract_paused_event`   | `pause`             | Admin pauses the whole contract.                       |
| `contract_unpaused_event` | `unpause`           | Admin unpauses the whole contract.                     |
| `action_paused_event`     | `pause_action`      | Admin pauses a single action (create/claim/withdraw).  |
| `action_unpaused_event`   | `unpause_action`    | Admin unpauses a single action.                        |
| `campaign_paused_event`   | `pause_campaign`    | Admin pauses a single campaign (`campaign_ref`).       |
| `campaign_unpaused_event` | `unpause_campaign`  | Admin unpauses a single campaign.                      |

> Function names refer to the public entrypoints in `src/lib.rs`.

## Payloads

**Note:** All events include `schema_version` and `timestamp` fields in addition to the fields listed below.

The six package lifecycle events share one shape (`PackageCreated`,
`PackageClaimed`, `PackageDisbursed`, `PackageRevoked`, `PackageRefunded`,
`PackageSwept`):

| Field        | Type      | Notes                                             |
| ------------ | --------- | ------------------------------------------------- |
| `package_id` | `u64`     | Stable primary key for the package.               |
| `recipient`  | `Address` | Intended recipient of the package.                |
| `amount`     | `i128`    | Package amount in token base units.               |
| `actor`      | `Address` | Account that performed the action (funder/admin). |
| `timestamp`  | `u64`     | Ledger close time (Unix seconds).                 |
| `schema_version` | `u32` | Event structure version (currently 1).           |

**Additional fields for specific events:**
- `PackageClaimed` and `PackageDisbursed`: `receipt_hash: String` (optional off-chain receipt hash)

Pool / administrative events:

| Event                   | Additional Fields                                                         |
| ----------------------- | ------------------------------------------------------------------------- |
| `EscrowFunded`          | `from: Address`, `token: Address`, `amount: i128`                        |
| `BatchCreatedEvent`     | `ids: Vec<u64>`, `admin: Address`, `total_amount: i128`                   |
| `PackageReassigned`     | `package_id: u64`, `previous_recipient: Address`, `new_recipient: Address`, `actor: Address` |
| `ExtendedEvent`         | `package_id: u64`, `admin: Address`, `old_expires_at: u64`, `new_expires_at: u64` |
| `SurplusWithdrawnEvent` | `to: Address`, `token: Address`, `amount: i128`                           |
| `ContractPausedEvent`   | `admin: Address`                                                          |
| `ContractUnpausedEvent` | `admin: Address`                                                          |
| `ActionPausedEvent`     | `admin: Address`, `action: Symbol`                                        |
| `ActionUnpausedEvent`   | `admin: Address`, `action: Symbol`                                        |
| `CampaignPausedEvent`   | `admin: Address`, `campaign_ref: String`                                  |
| `CampaignUnpausedEvent` | `admin: Address`, `campaign_ref: String`                                  |

**Delegate events:**
| Event                   | Fields                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `DelegateAdded`         | `package_id: u64`, `recipient: Address`, `delegate: Address`, `actor: Address`, `expires_at: u64` |
| `DelegateRevoked`       | `package_id: u64`, `recipient: Address`, `delegate: Address`, `actor: Address` |
| `DelegateClaimed`       | `package_id: u64`, `recipient: Address`, `delegate: Address`, `amount: i128`, `actor: Address` |

**Admin events:**
| Event                   | Fields                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `AdminTransferInitiated`| `admin: Address`, `pending_admin: Address`                               |
| `AdminTransferAccepted` | `admin: Address`                                                          |
| `AdminTransferCancelled`| `admin: Address`                                                          |
| `TokenAdded`            | `admin: Address`, `token: Address`                                        |
| `TokenRemoved`          | `admin: Address`, `token: Address`                                        |

## Identifier stability (audit)

- Every package lifecycle event carries `package_id` (`u64`), which is the
  stable key indexers should use to correlate a package across its
  `created -> claimed | disbursed | revoked | refunded | swept` lifecycle.
- Batch creation emits one `package_created` per package **and** a single
  `batch_created_event` whose `ids` array lists exactly those `package_id`s.
  Indexers can rely on either signal; the individual `package_created` events
  are authoritative per-package, and `batch_created_event.ids` gives the batch
  grouping.
- `ExtendedEvent` uses the field name `package_id` (updated from `id` in v1)
  for consistency with other package events.
- **Schema Version Stability:** The `schema_version` field provides explicit
  versioning for event structure changes. Indexers should validate this field
  and implement version-specific parsing logic as needed.

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
3. **Assert the `schema_version` field is present and equals `EVENT_SCHEMA_VERSION`**.
4. Regenerate and commit the affected `test_snapshots/*.json` so the snapshot
   diff stays authoritative.

## Version Migration Guide for Indexers

When processing events, indexers should:

1. **Always check `schema_version`** before parsing event data
2. **Log warnings** for unknown schema versions
3. **Implement fallback logic** for unsupported versions
4. **Maintain parsing logic** for all supported versions

```typescript
// Example version-aware event processing
function parsePackageCreatedEvent(eventData: any): PackageCreated | null {
  const version = eventData.schema_version;
  
  if (version === 1) {
    // Current version parsing
    return {
      packageId: eventData.package_id,
      recipient: eventData.recipient,
      amount: eventData.amount,
      actor: eventData.actor,
      timestamp: eventData.timestamp,
      schemaVersion: version
    };
  } else {
    // Unknown version - log and return null or apply fallback logic
    console.warn(`Unknown schema version ${version} for package_created event`);
    return null;
  }
}
```