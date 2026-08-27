# AidEscrow Storage Key Layout (Canonical Reference)

This document is the canonical reference for the on-chain **ledger keys**
written by the `aid_escrow` contract. It exists so that contributors adding
features can check the occupied key space before choosing new keys, and so
that the upgrade/migration path (`migrate()`, see
[`VERSIONING.md`](./VERSIONING.md)) can be reasoned about without auditing
every call site.

All keys are defined in exactly one place: [`src/keys.rs`](./src/keys.rs).
Storage keys must not be constructed inline anywhere else — add a constant or
constructor to `keys.rs` and update this catalog in the same PR.

## Stability contract

- Key values are a **storage-layout interface**. Once a contract version is
  deployed, the runtime value of every key below is frozen: renaming a symbol
  changes the encoded ledger entry and orphans previously written data.
- New features must add keys through `src/keys.rs`, choose values that do not
  collide with anything in this catalog, and extend the collision tests in
  [`tests/storage_keys.rs`](./tests/storage_keys.rs) and
  `src/keys.rs`.
- The collision test suite asserts that (a) all singleton keys are pairwise
  distinct, (b) namespaced constructors map distinct inputs to distinct keys,
  and (c) no two constructors can produce an overlapping entry in a live
  Soroban environment.

## Storage families

| Family       | Lifetime                                                                 | Used for |
| :----------- | :----------------------------------------------------------------------- | :------- |
| **Instance** | Lives with the contract instance; never expires; carried over by upgrades. | Small config/accounting state that is read on almost every call. |
| **Persistent** | Archival entries with an extended TTL, refreshed on use; survive indefinitely as long as rent is maintained. | Per-package records, delegate data. |

The two families are disjoint ledgers: the same encoded key written to
instance storage and to persistent storage produces two independent entries.
`keys.rs` documents which family each key belongs to.

## Singleton keys

A singleton key is a bare `Symbol`; exactly one entry exists per key.

### Instance storage

| Constant (`keys::`)     | Encoded key    | Stored type | Written by / lifetime |
| :---------------------- | :------------- | :---------- | :-------------------- |
| `KEY_ADMIN`             | `"admin"`      | `Address`   | `init`; replaced by accepted admin transfer. Permanent. |
| `KEY_PENDING_ADMIN`     | `"pend_adm"`   | `Address`   | `transfer_admin`. **Ephemeral**: removed by `accept_admin` / `cancel_admin_transfer`. Absent when no transfer is pending. |
| `KEY_VERSION`           | `"version"`    | `u32`       | `init` (=1); bumped by `migrate`. Permanent. |
| `KEY_CONFIG`            | `"config"`     | `Config`    | `init`, `set_config`, `add_allowed_token`, `remove_allowed_token`. Permanent; readers fall back to defaults if absent. |
| `KEY_DISTRIBUTORS`      | `"dstrbtrs"`   | `Map<Address, bool>` | `add_distributor` / `remove_distributor`. Permanent. |
| `KEY_PAUSED`            | `"paused"`     | `bool`      | `pause` / `unpause`. Permanent flag. |
| `KEY_PAUSE_CREATE`      | `"p_create"`   | `bool`      | `pause_action("create")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_CLAIM`       | `"p_claim"`    | `bool`      | `pause_action("claim")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_REFUND`      | `"p_refund"`   | `bool`      | `pause_action("refund")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_WITHDRAW`    | `"p_wdrw"`     | `bool`      | `pause_action("withdraw")` / `unpause_action`. Permanent flag. |
| `KEY_CAMPAIGN_PAUSED`   | `"camp_pzd"`   | `Map<String, bool>` | `pause_campaign` / `unpause_campaign`, keyed by `campaign_ref`. Grows with campaigns; permanent. |
| `KEY_TOTAL_LOCKED`      | `"locked"`     | `Map<Address, i128>` (token → locked amount) | Updated on package create/claim/disburse/revoke/cancel/refund. **Derived bookkeeping** over live packages. |
| `KEY_TOTAL_CLAIMED`     | `"claimed"`    | `Map<Address, i128>` (token → cumulative claimed) | Claim paths only. Monotonic accounting. |
| `KEY_RECIPIENT_LAST_CLAIM` | `"lastclaim"` | `Map<Address, u64>` (recipient → successful-claim timestamp) | Successful claim paths only. Enforces the optional `Config.claim_cooldown`; absent entries have no cooldown history. |
| `KEY_PKG_COUNTER`       | `"pkg_cnt"`    | `u64`       | Package creation. Highest assigned id + 1; upper bound for id scans (`get_campaign_package_count`, etc.). |
| `KEY_PKG_IDX`           | `"pkg_idx"`    | `u64`       | Package creation. Count of aggregation-index entries; positional bound for `get_aggregates`. May exceed `KEY_PKG_COUNTER` when explicit ids are used. |

### Persistent storage

| Constant (`keys::`)     | Encoded key | Stored type | Written by / lifetime |
| :---------------------- | :---------- | :---------- | :-------------------- |
| `KEY_DELEGATES`         | `"dlgts"`   | `Map<u64, Address>` (package id → delegate) | Delegate set/clear/sweep. Entries removed on claim, revoke, or expiry sweep. |
| `KEY_DELEGATE_HISTORY`  | `"dlgh"`    | `Vec<DelegateHistory>` | Append-only audit trail; grows forever. |
| `KEY_DELEGATE_EXPIRY`   | `"dlgexp"`  | `Map<u64, u64>` (package id → expiry timestamp) | `set_delegate_with_expiry`; pruned on claim/clear/sweep. |

## Namespaced keys

Namespaced keys are `(Symbol, u64)` tuples in persistent storage. Each has a
dedicated prefix symbol so namespaces can never collide regardless of the
numeric component:

| Constructor                    | Encoded key        | Stored type | Written by / lifetime |
| :----------------------------- | :----------------- | :---------- | :-------------------- |
| `package_key(id)`              | `("pkg", id)`      | `Package`   | `create_package` / `batch_create_packages`. One per aid package; retained after terminal states (Claimed/Cancelled/Refunded) for history. |
| `package_index_entry(position)`| `("pidx", position)` | `u64` (a package id) | Package creation; dense positional index used by `get_aggregates`. Never removed. |

Injectivity guarantees asserted by tests: `package_key` is injective in `id`,
`package_index_entry` is injective in `position`, and the prefixes `"pkg"` /
`"pidx"` differ from each other and from every singleton above.

## Metadata sub-keys (NOT ledger keys)

Package metadata (`Map<Symbol, String>` stored inside each `Package`) uses its
own field names. These are data-structure schema rather than storage keys, but
they share the same stability contract and are centralized in `keys.rs` for a
single source of truth:

| Constant                  | Field name        | Meaning |
| :------------------------ | :---------------- | :------ |
| `META_MERKLE_ROOT_KEY`    | `"merkle_root"`   | Hex-encoded 32-byte Merkle root gating claims via `claim_with_proof`. |
| `META_CAMPAIGN_REF`       | `"campaign_ref"`  | Groups packages into a pausable campaign. |
| `META_CLAIM_STARTS_AT`    | `"claim_starts_at"` | Overrides claim-window start (unix seconds). |
| `META_RECEIPT_HASH`       | `"receipt_hash"`  | Optional off-chain receipt hash echoed in claim/disburse events. |

## Migration considerations

`migrate()` (admin-only, bumps `KEY_VERSION`) must consider every key listed
above. Rules of thumb:

1. **Never rename or re-encode an existing key** unless a migration copies the
   data to the new key *and* removes the old entry within the same version
   bump. Renames without migration strand funds and accounting.
2. **Must be preserved verbatim across any upgrade** (state loss = fund loss):
   `KEY_ADMIN`, `KEY_PENDING_ADMIN` *(if a transfer is mid-flight)*,
   all `("pkg", id)` records, `KEY_TOTAL_LOCKED`, `KEY_TOTAL_CLAIMED`,
   `KEY_PKG_COUNTER`, `KEY_PKG_IDX`, all `("pidx", position)` entries, and the
   three delegate keys (`KEY_DELEGATES`, `KEY_DELEGATE_HISTORY`,
   `KEY_DELEGATE_EXPIRY`).
3. **Safe to drop/reset without fund impact** (policy flags only):
   `KEY_PAUSED`, `KEY_PAUSE_*`, `KEY_CAMPAIGN_PAUSED`, `KEY_DISTRIBUTORS`,
   `KEY_CONFIG` *(re-initialize before unpausing)*. Dropping them changes
   behaviour, not solvency.
4. **Derived/recomputable**: `KEY_TOTAL_LOCKED` can be rebuilt by scanning all
   `("pkg", id)` records with status `Created`; `KEY_PKG_COUNTER` /
   `KEY_PKG_IDX` can be rebuilt from max id / index density. Prefer repairing
   over recomputing on Mainnet (cost), but know it is possible.
5. **Version-gate every change**: read `KEY_VERSION` first; migrations run
   strictly one step at a time ((1→2), (2→3), …). Any newly introduced key
   must default gracefully when absent (see existing `unwrap_or` patterns).
6. **Metadata sub-keys** are part of stored `Package` payloads: changing their
   interpretation requires migrating package records, not just top-level keys.

## Verification

Run the collision-safety suite:

```bash
cd app/onchain/contracts/aid_escrow
cargo test --test storage_keys
cargo test -p aid_escrow keys:: # unit-level injectivity/distinctness checks
```
