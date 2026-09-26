//! Centralized storage key layout for the `aid_escrow` contract.
//!
//! Every ledger key used by this contract is defined or constructed here.
//! Do not build storage keys inline elsewhere; add a constant or constructor
//! to this module instead so the key space stays collision-free and
//! documented in one place. The canonical human-readable reference is
//! [`STORAGE_KEYS.md`](../../STORAGE_KEYS.md).
//!
//! # Key families
//!
//! - **Singleton keys**: a bare [`Symbol`] stored in either instance or
//!   persistent storage. Exactly one entry exists per key.
//! - **Namespaced keys**: a `(Symbol, u64)` tuple stored in persistent
//!   storage, constructed by [`package_key`] and [`package_index_entry`].
//!   Each namespace has its own prefix symbol, so entries of different
//!   namespaces can never collide regardless of the numeric component.
//!
//! # Stability
//!
//! The runtime values below are part of the contract's storage layout. They
//! must not change across upgrades unless a migration (see `migrate()` and
//! `STORAGE_KEYS.md`) moves the data to new keys. Renaming a symbol here
//! would orphan previously written ledger entries.

use soroban_sdk::{symbol_short, Symbol};

// --- Singleton keys: instance storage ---
// Instance storage lives and dies with the contract instance itself; it is
// never expired and is always carried over by upgrades/migrations.

/// Current administrator address (`Address`). Set by `init`, replaced on
/// accepted admin transfer.
pub const KEY_ADMIN: Symbol = symbol_short!("admin");
/// Nominated administrator during a two-step transfer (`Option<Address>`).
/// Present only while a transfer is pending; removed on accept/cancel.
pub const KEY_PENDING_ADMIN: Symbol = symbol_short!("pend_adm");
/// Storage-schema version number (`u32`). Bumped by `migrate`.
pub const KEY_VERSION: Symbol = symbol_short!("version");
/// Global configuration struct (`Config`: min_amount, max_expires_in,
/// allowed_tokens). Written by `init`, `set_config`, token allowlist ops.
pub const KEY_CONFIG: Symbol = symbol_short!("config");
/// Distributor allowlist (`Map<Address, bool>`). Admin-managed. Bounded by
/// [`KEY_MAX_DISTRIBUTORS`]; enumerable via `list_distributors`.
pub const KEY_DISTRIBUTORS: Symbol = symbol_short!("dstrbtrs");
/// Maximum number of addresses `KEY_DISTRIBUTORS` may hold at once (`u32`).
/// Enforced by `add_distributor`; configurable via `set_max_distributors`.
/// Falls back to `DEFAULT_MAX_DISTRIBUTORS` when absent.
pub const KEY_MAX_DISTRIBUTORS: Symbol = symbol_short!("max_dist");
/// Global pause flag (`bool`).
pub const KEY_PAUSED: Symbol = symbol_short!("paused");
/// Per-action pause flag for `create_package` / `batch_create_packages` (`bool`).
pub const KEY_PAUSE_CREATE: Symbol = symbol_short!("p_create");
/// Per-action pause flag for claim paths (`bool`).
pub const KEY_PAUSE_CLAIM: Symbol = symbol_short!("p_claim");
/// Per-action pause flag for `refund` (`bool`).
pub const KEY_PAUSE_REFUND: Symbol = symbol_short!("p_refund");
/// Per-action pause flag for `withdraw_surplus` (`bool`).
pub const KEY_PAUSE_WITHDRAW: Symbol = symbol_short!("p_wdrw");
/// Campaign pause registry (`Map<String, bool>` keyed by `campaign_ref`).
pub const KEY_CAMPAIGN_PAUSED: Symbol = symbol_short!("camp_pzd");
/// Per-token amount currently escrowed (`Map<Address, i128>`, token -> locked).
/// Derived from live `Created` packages; kept as running bookkeeping.
pub const KEY_TOTAL_LOCKED: Symbol = symbol_short!("locked");
/// Per-token cumulative amount ever claimed (`Map<Address, i128>`).
/// Monotonic; never decreases.
pub const KEY_TOTAL_CLAIMED: Symbol = symbol_short!("claimed");
/// Per-campaign, per-token amount currently escrowed
/// (`Map<String, Map<Address, i128>>`, campaign_ref -> token -> locked).
/// Scoped counterpart to [`KEY_TOTAL_LOCKED`]: updated at exactly the same
/// call sites (package creation increments it; claim, disburse, refund,
/// revoke, cancellation, and expiry sweep decrement it), so summing this
/// map's values for a token across every campaign equals
/// `KEY_TOTAL_LOCKED`'s value for that
/// token, minus whatever is locked in packages with no `campaign_ref` at
/// all. A package without a `campaign_ref` never appears here.
pub const KEY_CAMPAIGN_TOKEN_LOCKED: Symbol = symbol_short!("cmp_lock");
/// Per-campaign, per-token cumulative amount claimed
/// (`Map<String, Map<Address, i128>>`, campaign_ref -> token -> claimed).
/// Scoped counterpart to [`KEY_TOTAL_CLAIMED`]: incremented at exactly the
/// same call sites (`claim`, `claim_with_proof`, `claim_with_relayer`,
/// `batch_claim`) and, like `KEY_TOTAL_CLAIMED`, deliberately NOT on
/// `disburse` — an admin-forced disbursement does not add to either total.
/// Summing this map's values for a token across every campaign equals
/// `KEY_TOTAL_CLAIMED`'s value for that token, minus claims from packages
/// with no `campaign_ref`.
pub const KEY_CAMPAIGN_TOKEN_CLAIMED: Symbol = symbol_short!("cmp_clmd");
/// Timestamp of each recipient's most recent successful claim (`Map<Address, u64>`).
/// Used to enforce the optional per-recipient claim cooldown.
pub const KEY_RECIPIENT_LAST_CLAIM: Symbol = symbol_short!("lastclaim");
/// Highest assigned package id plus one (`u64`). Upper bound for id scans.
pub const KEY_PKG_COUNTER: Symbol = symbol_short!("pkg_cnt");
/// Number of entries written to the aggregation index (`u64`). Positional
/// upper bound for `get_aggregates`; may exceed the counter when explicit
/// ids are used.
pub const KEY_PKG_IDX: Symbol = symbol_short!("pkg_idx");

// --- Singleton keys: persistent storage ---
// Persistent-storage singletons owned by the delegate module.

/// Delegate per package (`Map<u64, Address>`, package id -> delegate).
pub const KEY_DELEGATES: Symbol = symbol_short!("dlgts");
/// Delegate change audit trail (`Vec<DelegateHistory>`), append-only.
pub const KEY_DELEGATE_HISTORY: Symbol = symbol_short!("dlgh");
/// Delegate expiry timestamps (`Map<u64, u64>`, package id -> expires_at).
pub const KEY_DELEGATE_EXPIRY: Symbol = symbol_short!("dlgexp");

// --- Namespaced keys: persistent storage ---

/// Namespace prefix for package records: `("pkg", id)`.
pub const NS_PACKAGE: Symbol = symbol_short!("pkg");
/// Namespace prefix for aggregation index entries: `("pidx", position)`.
pub const NS_PACKAGE_INDEX: Symbol = symbol_short!("pidx");

/// Key for the [`Package`](crate::Package) record with numeric id `id`
/// (persistent storage). Injective in `id`.
#[inline]
pub fn package_key(id: u64) -> (Symbol, u64) {
    (NS_PACKAGE, id)
}

/// Key for the aggregation index entry at position `index`, holding a
/// package id (`u64`, persistent storage). Injective in `index`.
#[inline]
pub fn package_index_entry(index: u64) -> (Symbol, u64) {
    (NS_PACKAGE_INDEX, index)
}

// --- Metadata sub-keys (NOT ledger keys) ---
// Field names inside a Package's metadata map. These are data-structure
// schema, not storage keys; they are listed here because they share the
// same "must stay stable" contract as the keys above.

/// Metadata field holding a hex-encoded Merkle root gating claims.
pub const META_MERKLE_ROOT_KEY: &str = "merkle_root";
/// Metadata field grouping packages into a pausable campaign.
pub const META_CAMPAIGN_REF: &str = "campaign_ref";
/// Metadata field overriding the time a claim window opens (unix seconds).
pub const META_CLAIM_STARTS_AT: &str = "claim_starts_at";
/// Metadata field holding an optional off-chain receipt hash.
pub const META_RECEIPT_HASH: &str = "receipt_hash";
/// Metadata field holding an optional off-chain evidence hash (64-char hex).
pub const META_EVIDENCE_HASH_KEY: &str = "evidence_hash";

#[cfg(test)]
mod tests {
    use super::*;

    /// Every singleton key, both storage families.
    fn singleton_keys() -> [Symbol; 22] {
        [
            KEY_ADMIN,
            KEY_PENDING_ADMIN,
            KEY_VERSION,
            KEY_CONFIG,
            KEY_DISTRIBUTORS,
            KEY_MAX_DISTRIBUTORS,
            KEY_PAUSED,
            KEY_PAUSE_CREATE,
            KEY_PAUSE_CLAIM,
            KEY_PAUSE_REFUND,
            KEY_PAUSE_WITHDRAW,
            KEY_CAMPAIGN_PAUSED,
            KEY_TOTAL_LOCKED,
            KEY_TOTAL_CLAIMED,
            KEY_CAMPAIGN_TOKEN_LOCKED,
            KEY_CAMPAIGN_TOKEN_CLAIMED,
            KEY_RECIPIENT_LAST_CLAIM,
            KEY_PKG_COUNTER,
            KEY_PKG_IDX,
            KEY_DELEGATES,
            KEY_DELEGATE_HISTORY,
            KEY_DELEGATE_EXPIRY,
        ]
    }

    #[test]
    fn singleton_keys_are_pairwise_distinct() {
        let all = singleton_keys();
        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                assert_ne!(
                    all[i], all[j],
                    "singleton key #{i} collides with singleton key #{j}"
                );
            }
        }
    }

    #[test]
    fn namespace_prefixes_are_distinct_and_disjoint_from_singletons() {
        let namespaces = [NS_PACKAGE, NS_PACKAGE_INDEX];
        assert_ne!(namespaces[0], namespaces[1]);

        let all = singleton_keys();
        for ns in namespaces.iter() {
            for k in all.iter() {
                assert_ne!(ns, k, "namespace prefix collides with a singleton key");
            }
        }
    }

    #[test]
    fn constructors_are_injective_for_distinct_inputs() {
        let samples = [0u64, 1, 2, 42, u32::MAX as u64, u64::MAX];
        for a in samples.iter() {
            for b in samples.iter() {
                if a == b {
                    assert_eq!(package_key(*a), package_key(*b));
                    assert_eq!(package_index_entry(*a), package_index_entry(*b));
                } else {
                    assert_ne!(
                        package_key(*a),
                        package_key(*b),
                        "package_key is not injective"
                    );
                    assert_ne!(
                        package_index_entry(*a),
                        package_index_entry(*b),
                        "package_index_entry is not injective"
                    );
                }
            }
        }
    }

    #[test]
    fn cross_namespace_keys_never_collide() {
        let samples = [0u64, 1, 7, u64::MAX];
        for x in samples.iter() {
            for y in samples.iter() {
                assert_ne!(
                    package_key(*x),
                    package_index_entry(*y),
                    "package and index namespaces collide"
                );
            }
        }
    }
}
