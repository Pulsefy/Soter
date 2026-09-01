//! TTL (time-to-live) management policy for long-lived storage entries.
//!
//! On Soroban, entries in **persistent** storage are archived when their TTL
//! expires and they are not bumped. An archived entry cannot be read or
//! written until it is restored, which would make a long-lived aid package
//! unclaimable purely through inactivity. This module centralises the policy
//! for deliberately extending the TTL of every long-lived entry so that
//! packages, delegate data, and the aggregation index remain readable and
//! claimable for as long as the contract is expected to serve them.
//!
//! # Policy
//!
//! - **Instance storage** lives and dies with the contract instance; it never
//!   expires and requires no TTL management.
//! - **Persistent storage** entries are bumped on every read and write that
//!   touches them. When the remaining TTL of an entry falls below
//!   [`PERSISTENT_TTL_THRESHOLD`], it is extended to
//!   [`PERSISTENT_TTL_EXTEND_TO`].
//! - **Temporary storage** is short-lived scratch state and is never bumped.
//!
//! The threshold and extension amounts are named constants so the policy can
//! be tuned in one place and audited against the documentation in
//! `STORAGE_KEYS.md`.

use soroban_sdk::Env;

/// Remaining TTL (in ledgers) below which a persistent entry is bumped.
///
/// Chosen so that entries are refreshed well before they are at risk of
/// archiving, while avoiding a bump on every single call. 31 days at ~5s per
/// ledger ≈ 535,680 ledgers.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 535_680;

/// Target TTL (in ledgers) that a persistent entry is extended to when it is
/// bumped. 90 days at ~5s per ledger ≈ 1,555,200 ledgers.
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 1_555_200;

/// Bump the TTL of a persistent-storage entry if its remaining TTL is below
/// [`PERSISTENT_TTL_THRESHOLD`], extending it to
/// [`PERSISTENT_TTL_EXTEND_TO`].
///
/// This is a no-op when the entry does not exist. It is safe to call on every
/// read and write of a long-lived persistent entry; the underlying ledger
/// operation is cheap and only performs work when the threshold is crossed.
pub fn bump_persistent<K>(env: &Env, key: &K)
where
    K: soroban_sdk::IntoVal<Env, soroban_sdk::Val> + Clone,
{
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}
