#![cfg(test)]

//! Collision-safety tests for the centralized storage key layout.
//!
//! These tests complement the unit tests in `src/keys.rs` by verifying key
//! behaviour against a real Soroban environment: two constructors must never
//! produce ledger entries that overlap, neither within a storage family nor
//! across families. See STORAGE_KEYS.md for the documented layout.

use aid_escrow::{AidEscrow, Package};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);
    let contract = env.register(AidEscrow, ());
    (env, contract)
}

/// Every singleton key defined in `aid_escrow::keys`, across both storage
/// families.
fn singletons() -> Vec<soroban_sdk::Symbol> {
    use aid_escrow::keys::*;
    vec![
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
        KEY_PKG_COUNTER,
        KEY_PKG_IDX,
        KEY_DELEGATES,
        KEY_DELEGATE_HISTORY,
        KEY_DELEGATE_EXPIRY,
    ]
}

#[test]
fn singleton_keys_are_pairwise_distinct() {
    let all = singletons();
    assert!(all.len() >= 21);
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
fn namespace_prefixes_never_reuse_a_singleton_name() {
    for ns in [
        aid_escrow::keys::NS_PACKAGE,
        aid_escrow::keys::NS_PACKAGE_INDEX,
    ] {
        for k in singletons() {
            assert_ne!(ns, k, "namespace prefix collides with a singleton key");
        }
    }
}

#[test]
fn constructors_map_distinct_inputs_to_distinct_keys() {
    let samples: [u64; 6] = [0, 1, 2, 42, u32::MAX as u64, u64::MAX];
    for x in samples.iter() {
        for y in samples.iter() {
            if x == y {
                assert_eq!(aid_escrow::package_key(*x), aid_escrow::package_key(*y));
            } else {
                assert_ne!(
                    aid_escrow::package_key(*x),
                    aid_escrow::package_key(*y),
                    "two package ids share one storage key"
                );
                assert_ne!(
                    aid_escrow::package_index_entry(*x),
                    aid_escrow::package_index_entry(*y),
                    "two index positions share one storage key"
                );
            }
        }
    }
}

#[test]
fn package_and_index_namespaces_cannot_collide() {
    let samples: [u64; 4] = [0, 1, 7, u64::MAX];
    for x in samples.iter() {
        for y in samples.iter() {
            assert_ne!(
                aid_escrow::package_key(*x),
                aid_escrow::package_index_entry(*y),
                "a package record and an index entry share one storage key"
            );
        }
    }
}

/// Proves at the real storage layer that writing through one constructor can
/// never satisfy a lookup through another: instance vs persistent storage are
/// disjoint ledgers, and namespaced tuples never overlap each other or any
/// singleton entry.
#[test]
fn no_two_constructors_share_a_ledger_entry_in_a_live_env() {
    let (env, contract) = setup();

    env.as_contract(&contract, || {
        // Populate one representative entry per family/namespace.
        let package = Package {
            id: 5,
            recipient: Address::generate(&env),
            amount: 1_000,
            token: Address::generate(&env),
            status: aid_escrow::PackageStatus::Created,
            created_at: 1000,
            expires_at: 2000,
            claim_starts_at: 1000,
            metadata: soroban_sdk::Map::new(&env),
            evidence_hash: soroban_sdk::String::from_str(&env, ""),
        };
        env.storage()
            .persistent()
            .set(&aid_escrow::package_key(5), &package);
        env.storage()
            .instance()
            .set(&aid_escrow::KEY_ADMIN, &Address::generate(&env));
        env.storage()
            .instance()
            .set(&aid_escrow::KEY_PKG_COUNTER, &6u64);

        // A package record is invisible to every other constructor.
        assert!(!env
            .storage()
            .persistent()
            .has(&aid_escrow::package_index_entry(5)));
        assert!(!env
            .storage()
            .persistent()
            .has(&aid_escrow::keys::KEY_DELEGATES));

        // An index entry is invisible to the package constructor and holds its
        // own payload at a position no package record occupies.
        env.storage()
            .persistent()
            .set(&aid_escrow::package_index_entry(7), &9u64);
        assert_eq!(
            env.storage()
                .persistent()
                .get::<_, u64>(&aid_escrow::package_index_entry(7)),
            Some(9u64)
        );
        assert!(!env.storage().persistent().has(&aid_escrow::package_key(7)));

        // Instance-storage singletons never leak into persistent lookups.
        assert!(!env.storage().persistent().has(&aid_escrow::KEY_ADMIN));
        assert!(!env.storage().persistent().has(&aid_escrow::KEY_PKG_COUNTER));

        // And vice versa: persistent namespaces are absent from instance storage.
        assert!(!env.storage().instance().has(&aid_escrow::package_key(5)));

        // Distinct inputs under the same constructor address distinct entries,
        // and the written record round-trips intact.
        assert!(!env.storage().persistent().has(&aid_escrow::package_key(6)));
        assert_eq!(
            env.storage()
                .persistent()
                .get::<_, Package>(&aid_escrow::package_key(5)),
            Some(package)
        );
    });
}

/// Guard so future contributors cannot silently drop a key from the module:
/// the count of exported singleton keys must match the documented catalog in
/// STORAGE_KEYS.md. Update both together.
#[test]
fn singleton_catalog_matches_documented_layout() {
    assert_eq!(singletons().len(), 21);
}
