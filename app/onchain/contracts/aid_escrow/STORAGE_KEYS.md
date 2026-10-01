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

**Namespace revision 1** covers the 22 singleton symbols and two tuple
constructors below. This revision describes the layout in the source tree; it
is separate from `KEY_VERSION`, the per-contract value changed by `migrate`.
When a release adds or re-encodes a ledger key, increment this revision and
record the contract versions affected in the migration checklist below.

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
| **Instance** | Shares the contract instance's lifetime and is carried over by code upgrades. | Small config/accounting state that is read on almost every call. |
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
| `KEY_DISTRIBUTORS`      | `"dstrbtrs"`   | `Map<Address, bool>` | `add_distributor` / `remove_distributor`. Bounded by `KEY_MAX_DISTRIBUTORS`; enumerable via `list_distributors`. Permanent. |
| `KEY_MAX_DISTRIBUTORS`  | `"max_dist"`   | `u32`       | `set_max_distributors`. Caps `KEY_DISTRIBUTORS` size; falls back to `DEFAULT_MAX_DISTRIBUTORS` when absent. Permanent. |
| `KEY_PAUSED`            | `"paused"`     | `bool`      | `pause` / `unpause`. Permanent flag. |
| `KEY_PAUSE_CREATE`      | `"p_create"`   | `bool`      | `pause_action("create")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_CLAIM`       | `"p_claim"`    | `bool`      | `pause_action("claim")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_REFUND`      | `"p_refund"`   | `bool`      | `pause_action("refund")` / `unpause_action`. Permanent flag. |
| `KEY_PAUSE_WITHDRAW`    | `"p_wdrw"`     | `bool`      | `pause_action("withdraw")` / `unpause_action`. Permanent flag. |
| `KEY_CAMPAIGN_PAUSED`   | `"camp_pzd"`   | `Map<String, bool>` | `pause_campaign` / `unpause_campaign`, keyed by `campaign_ref`. Grows with campaigns; permanent. |
| `KEY_TOTAL_LOCKED`      | `"locked"`     | `Map<Address, i128>` (token → locked amount) | Updated on package create/claim/disburse/revoke/cancel/refund. **Derived bookkeeping** over live packages. |
| `KEY_TOTAL_CLAIMED`     | `"claimed"`    | `Map<Address, i128>` (token → cumulative claimed) | Claim paths only. Monotonic accounting. |
| `KEY_CAMPAIGN_TOKEN_LOCKED` | `"cmp_lock"` | `Map<String, Map<Address, i128>>` (campaign_ref → token → locked) | Same call sites as `KEY_TOTAL_LOCKED` (package creation increments; claim, disburse, refund, revoke, cancellation, and expiry sweep decrement). Scoped, per-campaign bookkeeping. |
| `KEY_CAMPAIGN_TOKEN_CLAIMED` | `"cmp_clmd"` | `Map<String, Map<Address, i128>>` (campaign_ref → token → cumulative claimed) | Same call sites as `KEY_TOTAL_CLAIMED` (claim paths only, not `disburse`). Monotonic per campaign+token. |
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

## Read and write call sites

These are the functions that access each ledger entry directly. A public
entry point that calls a listed helper also accesses that key indirectly.
Except where noted, functions are in `src/lib.rs`; `delegate::` functions are
in `src/delegate.rs`. `has` counts as a read, and `remove` counts as a write.
The pause keys share a dynamic `key` returned by `get_pause_key`; campaign
amount keys share a dynamic `storage_key` in `adjust_campaign_token_amount`.

| Key | Reads (`get` / `has`) | Writes (`set` / `remove`) |
| :--- | :--- | :--- |
| `KEY_ADMIN` | `init`, `get_admin` | `init`, `accept_admin` |
| `KEY_PENDING_ADMIN` | `get_pending_admin`, `accept_admin`, `cancel_admin_transfer` | `transfer_admin`, `accept_admin`, `cancel_admin_transfer` |
| `KEY_VERSION` | `get_version` (called by `migrate`) | `init`, `migrate` |
| `KEY_CONFIG` | `get_config` (used by validation and claim paths) | `init`, `set_config`, `add_allowed_token`, `remove_allowed_token` |
| `KEY_DISTRIBUTORS` | `add_distributor`, `remove_distributor`, `get_distributor_count`, `is_distributor`, `list_distributors`, `require_admin_or_distributor` | `add_distributor`, `remove_distributor` |
| `KEY_MAX_DISTRIBUTORS` | `get_max_distributors` | `set_max_distributors` |
| `KEY_PAUSED` | `is_paused`, `check_action_paused` | `pause`, `unpause` |
| `KEY_PAUSE_CREATE` | `is_action_paused`, `check_action_paused` (via `get_pause_key`) | `pause_action`, `unpause_action` (via `get_pause_key`) |
| `KEY_PAUSE_CLAIM` | `is_action_paused`, `check_action_paused` (via `get_pause_key`) | `pause_action`, `unpause_action` (via `get_pause_key`) |
| `KEY_PAUSE_REFUND` | `is_action_paused`, `check_action_paused` (via `get_pause_key`) | `pause_action`, `unpause_action` (via `get_pause_key`) |
| `KEY_PAUSE_WITHDRAW` | `is_action_paused`, `check_action_paused` (via `get_pause_key`) | `pause_action`, `unpause_action` (via `get_pause_key`) |
| `KEY_CAMPAIGN_PAUSED` | `pause_campaign`, `unpause_campaign`, `is_campaign_paused`, `check_campaign_paused` | `pause_campaign`, `unpause_campaign` |
| `KEY_TOTAL_LOCKED` | `create_package`, `batch_create_packages`, `withdraw_surplus`, `increment_locked`, `decrement_locked`, `get_total_locked` | `increment_locked`, `decrement_locked`, `batch_create_packages` |
| `KEY_TOTAL_CLAIMED` | `increment_claimed`, `get_total_claimed` | `increment_claimed` |
| `KEY_CAMPAIGN_TOKEN_LOCKED` | `adjust_campaign_token_amount` (from `increment_locked` / `decrement_locked`), `apply_campaign_locked_batch_deltas`, `get_campaign_token_locked` | `backfill_campaign_token_totals`, `adjust_campaign_token_amount`, `apply_campaign_locked_batch_deltas` |
| `KEY_CAMPAIGN_TOKEN_CLAIMED` | `adjust_campaign_token_amount` (from `increment_claimed`), `get_campaign_token_claimed` | `backfill_campaign_token_totals`, `adjust_campaign_token_amount` |
| `KEY_RECIPIENT_LAST_CLAIM` | `ensure_recipient_cooldown`, `record_recipient_claim` | `record_recipient_claim` |
| `KEY_PKG_COUNTER` | `backfill_campaign_token_totals`, `create_package`, `batch_create_packages`, `get_campaign_package_count`, `get_campaign_claim_count`, `get_recipient_package_count`, `list_recipient_packages` | `create_package`, `batch_create_packages` |
| `KEY_PKG_IDX` | `create_package`, `batch_create_packages`, `get_aggregates`, `sweep_expired_packages` | `create_package`, `batch_create_packages` |
| `KEY_DELEGATES` | `delegate::load_delegates` | `delegate::save_delegates` |
| `KEY_DELEGATE_HISTORY` | `delegate::load_delegate_history` | `delegate::save_delegate_history` |
| `KEY_DELEGATE_EXPIRY` | `delegate::load_delegate_expiry`, `set_delegate` | `delegate::save_delegate_expiry` |
| `package_key(id)` | `backfill_campaign_token_totals`, `create_package` (collision check), claim/disburse/refund/revoke/cancel/reassignment/expiry helpers, `get_package`, `get_aggregates`, package count/list queries, `set_delegate`, `set_delegate_with_expiry`, `revoke_delegate`, `delegate::validate_package_state`, `delegate::set_delegate`, `delegate::sweep_expired_delegates` | `create_package`, `batch_create_packages`, `claim_with_relayer`, `finalize_claim`, `disburse`, `reassign_package`, `revoke_one_for_batch`, `refund_one_for_batch`, `revoke`, `refund`, `cancel_package`, `attach_evidence_hash`, `extend_expiry`, `sweep_expired_packages` |
| `package_index_entry(position)` | `get_aggregates`, `sweep_expired_packages` | `create_package`, `batch_create_packages` |

For `package_key(id)`, the claim and management readers summarized in the table
are `claim`, `claim_with_proof`, `claim_with_relayer`, `claim_one_for_batch`,
`disburse`, `reassign_package`, `revoke_one_for_batch`, `refund_one_for_batch`,
`revoke`, `refund`, `cancel_package`, `attach_evidence_hash`, `extend_expiry`,
and `sweep_expired_packages`. The query readers are `get_package`,
`get_aggregates`, `get_campaign_package_count`, `get_campaign_claim_count`,
`get_recipient_package_count`, and `list_recipient_packages`. The same
`Package` record is read and rewritten by status and metadata operations,
even when they do not create a new key.

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
| `META_EVIDENCE_HASH_KEY`   | `"evidence_hash"` | Reserved metadata field name; current evidence anchoring writes the separate `Package.evidence_hash` field, not this metadata key. |

## Migration considerations

`migrate()` (admin-only, bumps `KEY_VERSION`) must consider every key listed
above. Rules of thumb:

For each future version bump, review this complete ledger-key checklist. The
current `(1, 2)` migration backfills the two campaign amount maps from package
records; other entries keep their existing encoding. Mark any new key and its
first contract version in this document when changing the layout.

| Keys to review | Migration question |
| :--- | :--- |
| `KEY_ADMIN`, `KEY_PENDING_ADMIN` | Preserve the admin and any pending transfer; migrate address encoding if it changes. |
| `KEY_VERSION` | Read the old value before transforming state; write the new version only after the step succeeds. |
| `KEY_CONFIG`, `KEY_DISTRIBUTORS`, `KEY_MAX_DISTRIBUTORS` | Preserve or intentionally reset configuration and distributor permissions; document changed defaults. |
| `KEY_PAUSED`, `KEY_PAUSE_CREATE`, `KEY_PAUSE_CLAIM`, `KEY_PAUSE_REFUND`, `KEY_PAUSE_WITHDRAW`, `KEY_CAMPAIGN_PAUSED` | Preserve or intentionally reset every global, action, and campaign pause state. |
| `KEY_TOTAL_LOCKED`, `KEY_TOTAL_CLAIMED`, `KEY_CAMPAIGN_TOKEN_LOCKED`, `KEY_CAMPAIGN_TOKEN_CLAIMED` | Keep global and campaign accounting consistent with package records; backfill or transform maps when their shape changes. |
| `KEY_RECIPIENT_LAST_CLAIM` | Preserve recipient cooldown timestamps or explicitly define the reset policy for existing recipients. |
| `KEY_PKG_COUNTER`, `KEY_PKG_IDX`, `package_key(id)`, `package_index_entry(position)` | Preserve both counters and every package/index entry together; a changed `Package` encoding requires rewriting stored records. |
| `KEY_DELEGATES`, `KEY_DELEGATE_HISTORY`, `KEY_DELEGATE_EXPIRY` | Preserve delegate permissions, expiry data, and audit history (or migrate their payloads). |

The five `META_*` names above are inside `Package` payloads, so review their
meaning alongside `package_key(id)` if package metadata or encoding changes.

1. **Never rename or re-encode an existing key** unless a migration copies the
   data to the new key *and* removes the old entry within the same version
   bump. Renames without migration strand funds and accounting.
2. **Must be preserved verbatim across any upgrade** (state loss = fund loss):
   `KEY_ADMIN`, `KEY_PENDING_ADMIN` *(if a transfer is mid-flight)*,
   all `("pkg", id)` records, `KEY_TOTAL_LOCKED`, `KEY_TOTAL_CLAIMED`,
   `KEY_CAMPAIGN_TOKEN_LOCKED`, `KEY_CAMPAIGN_TOKEN_CLAIMED`,
   `KEY_PKG_COUNTER`, `KEY_PKG_IDX`, all `("pidx", position)` entries, and the
   three delegate keys (`KEY_DELEGATES`, `KEY_DELEGATE_HISTORY`,
   `KEY_DELEGATE_EXPIRY`).
3. **Safe to drop/reset without fund impact** (policy flags only):
   `KEY_PAUSED`, `KEY_PAUSE_*`, `KEY_CAMPAIGN_PAUSED`, `KEY_DISTRIBUTORS`,
   `KEY_MAX_DISTRIBUTORS` *(resets to `DEFAULT_MAX_DISTRIBUTORS`)*,
   `KEY_CONFIG` *(re-initialize before unpausing)*. Dropping them changes
   behaviour, not solvency.
4. **Derived/recomputable**: `KEY_TOTAL_LOCKED` can be rebuilt by scanning all
   `("pkg", id)` records with status `Created`; `KEY_PKG_COUNTER` /
   `KEY_PKG_IDX` can be rebuilt from max id / index density. Prefer repairing
   over recomputing on Mainnet (cost), but know it is possible.
   `KEY_CAMPAIGN_TOKEN_LOCKED` is likewise fully recomputable from
   `Created`-status package records (unambiguous: status + campaign_ref +
   token + amount fully determine it). `KEY_CAMPAIGN_TOKEN_CLAIMED` can only
   be **approximately** rebuilt from `Claimed`-status records, because a
   stored `Package` does not distinguish "claimed by the recipient" from
   "force-disbursed by the admin" — both set `status = Claimed`. The `(1, 2)`
   step of `migrate()` performs this best-effort backfill once (see
   `Self::backfill_campaign_token_totals` in `src/lib.rs`); any campaign with
   a pre-migration `disburse` may show a `KEY_CAMPAIGN_TOKEN_CLAIMED` total
   that slightly overcounts relative to `KEY_TOTAL_CLAIMED`'s stricter
   definition for that one historical slice. All activity from the migration
   forward is exact, because going forward both keys are written together by
   the same helper (`Self::increment_claimed`).
5. **Version-gate every change**: read `KEY_VERSION` first and add an explicit
   branch for each supported transition. The current `migrate` handles `(1, 2)`
   specially and treats other pairs as no-ops, so a future bump must not rely
   on automatic sequential migrations. Any newly introduced key must default
   gracefully when absent (see existing `unwrap_or` patterns).
6. **Metadata sub-keys** are part of stored `Package` payloads: changing their
   interpretation requires migrating package records, not just top-level keys.

## Verification

Run the collision-safety suite:

```bash
cd app/onchain/contracts/aid_escrow
cargo test --test storage_keys
cargo test -p aid_escrow keys:: # unit-level injectivity/distinctness checks
```
