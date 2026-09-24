//! Tests for bounding and auditing distributor role growth (issue #976).
//!
//! `add_distributor` / `remove_distributor` previously had no cap and no
//! enumeration path, so an admin could not audit who held distribution
//! rights and the set could grow until iteration over it became costly.
//! These tests cover the configurable cap, explicit duplicate/not-found
//! errors, paginated enumeration, and that add/remove emit events carrying
//! the resulting set size.

#![cfg(test)]

use aid_escrow::{
    AidEscrow, AidEscrowClient, Error, DEFAULT_MAX_DISTRIBUTORS, MAX_DISTRIBUTOR_PAGE_SIZE,
};
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, Symbol, TryFromVal, Val,
};

fn sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

/// Returns the data payload of the most recent event with the given topic
/// symbol, emitted by `contract_id`. Mirrors the helper in `tests/events.rs`.
fn last_event_data(env: &Env, contract_id: &Address, topic: &str) -> Val {
    let expected = sym(env, topic);
    for (id, topics, data) in env.events().all().iter().rev() {
        if &id != contract_id {
            continue;
        }
        if let Some(first) = topics.first() {
            if let Ok(s) = Symbol::try_from_val(env, &first) {
                if s == expected {
                    return data;
                }
            }
        }
    }
    panic!("expected event with topic '{}'", topic);
}

fn data_u32(env: &Env, data: &Val, field: &str) -> u32 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    u32::try_from_val(env, &val).expect("not u32")
}

fn data_address(env: &Env, data: &Val, field: &str) -> Address {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    Address::try_from_val(env, &val).expect("not an address")
}

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    contract_id: Address,
    admin: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        client.init(&admin);

        Fixture {
            env,
            client,
            contract_id,
            admin,
        }
    }
}

// --- Adding distributors ---

#[test]
fn add_distributor_grants_privileges_and_is_enumerable() {
    let f = Fixture::new();
    let distributor = Address::generate(&f.env);

    f.client.add_distributor(&distributor);

    assert!(f.client.is_distributor(&distributor));
    assert_eq!(f.client.get_distributor_count(), 1);

    let listed = f.client.list_distributors(&0, &10);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed.get(0).unwrap(), distributor);
}

#[test]
fn add_distributor_fails_for_duplicate() {
    let f = Fixture::new();
    let distributor = Address::generate(&f.env);
    f.client.add_distributor(&distributor);

    let result = f.client.try_add_distributor(&distributor);

    assert_eq!(result, Err(Ok(Error::DistributorAlreadyExists)));
    // The failed duplicate add must not change the set size.
    assert_eq!(f.client.get_distributor_count(), 1);
}

#[test]
fn add_distributor_emits_event_with_resulting_set_size() {
    let f = Fixture::new();
    let d1 = Address::generate(&f.env);
    let d2 = Address::generate(&f.env);

    f.client.add_distributor(&d1);
    let data = last_event_data(&f.env, &f.contract_id, "distributor_added");
    assert_eq!(data_address(&f.env, &data, "distributor"), d1);
    assert_eq!(data_address(&f.env, &data, "admin"), f.admin);
    assert_eq!(data_u32(&f.env, &data, "total_distributors"), 1);

    f.client.add_distributor(&d2);
    let data = last_event_data(&f.env, &f.contract_id, "distributor_added");
    assert_eq!(data_u32(&f.env, &data, "total_distributors"), 2);
}

// --- Removing distributors ---

#[test]
fn remove_distributor_revokes_privileges() {
    let f = Fixture::new();
    let distributor = Address::generate(&f.env);
    f.client.add_distributor(&distributor);

    f.client.remove_distributor(&distributor);

    assert!(!f.client.is_distributor(&distributor));
    assert_eq!(f.client.get_distributor_count(), 0);
}

#[test]
fn remove_distributor_fails_when_not_a_distributor() {
    let f = Fixture::new();
    let stranger = Address::generate(&f.env);

    let result = f.client.try_remove_distributor(&stranger);

    assert_eq!(result, Err(Ok(Error::DistributorNotFound)));
}

#[test]
fn remove_distributor_emits_event_with_resulting_set_size() {
    let f = Fixture::new();
    let d1 = Address::generate(&f.env);
    let d2 = Address::generate(&f.env);
    f.client.add_distributor(&d1);
    f.client.add_distributor(&d2);

    f.client.remove_distributor(&d1);

    let data = last_event_data(&f.env, &f.contract_id, "distributor_removed");
    assert_eq!(data_address(&f.env, &data, "distributor"), d1);
    assert_eq!(data_address(&f.env, &data, "admin"), f.admin);
    assert_eq!(data_u32(&f.env, &data, "total_distributors"), 1);
}

// --- Cap enforcement ---

#[test]
fn get_max_distributors_defaults_to_the_documented_constant() {
    let f = Fixture::new();
    assert_eq!(f.client.get_max_distributors(), DEFAULT_MAX_DISTRIBUTORS);
}

#[test]
fn add_distributor_enforces_the_configured_cap() {
    let f = Fixture::new();
    f.client.set_max_distributors(&2);

    f.client.add_distributor(&Address::generate(&f.env));
    f.client.add_distributor(&Address::generate(&f.env));

    let result = f.client.try_add_distributor(&Address::generate(&f.env));

    assert_eq!(result, Err(Ok(Error::DistributorSetFull)));
    assert_eq!(f.client.get_distributor_count(), 2);
}

#[test]
fn removing_a_distributor_frees_a_cap_slot() {
    let f = Fixture::new();
    f.client.set_max_distributors(&1);
    let d1 = Address::generate(&f.env);
    f.client.add_distributor(&d1);

    let blocked = f.client.try_add_distributor(&Address::generate(&f.env));
    assert_eq!(blocked, Err(Ok(Error::DistributorSetFull)));

    f.client.remove_distributor(&d1);
    let d2 = Address::generate(&f.env);
    let result = f.client.try_add_distributor(&d2);

    assert!(result.is_ok());
    assert!(f.client.is_distributor(&d2));
}

#[test]
fn lowering_the_cap_does_not_evict_existing_distributors() {
    let f = Fixture::new();
    let d1 = Address::generate(&f.env);
    let d2 = Address::generate(&f.env);
    f.client.add_distributor(&d1);
    f.client.add_distributor(&d2);

    // Lower the cap below the current count.
    f.client.set_max_distributors(&1);

    // Existing distributors are untouched...
    assert_eq!(f.client.get_distributor_count(), 2);
    assert!(f.client.is_distributor(&d1));
    assert!(f.client.is_distributor(&d2));

    // ...but no further additions are allowed until the count drops.
    let result = f.client.try_add_distributor(&Address::generate(&f.env));
    assert_eq!(result, Err(Ok(Error::DistributorSetFull)));
}

#[test]
fn set_max_distributors_rejects_zero() {
    let f = Fixture::new();
    let result = f.client.try_set_max_distributors(&0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// --- Enumeration / pagination ---

#[test]
fn list_distributors_returns_empty_when_none_exist() {
    let f = Fixture::new();
    assert_eq!(f.client.list_distributors(&0, &10).len(), 0);
    assert_eq!(f.client.get_distributor_count(), 0);
}

#[test]
fn list_distributors_paginates_with_cursor_and_limit() {
    let f = Fixture::new();
    let mut addrs = std::vec::Vec::new();
    for _ in 0..5 {
        let addr = Address::generate(&f.env);
        f.client.add_distributor(&addr);
        addrs.push(addr);
    }

    let page1 = f.client.list_distributors(&0, &2);
    let page2 = f.client.list_distributors(&2, &2);
    let page3 = f.client.list_distributors(&4, &2);

    assert_eq!(page1.len(), 2);
    assert_eq!(page2.len(), 2);
    assert_eq!(page3.len(), 1);

    // Every distributor appears exactly once across the concatenated pages.
    let mut seen: std::vec::Vec<Address> = std::vec::Vec::new();
    for page in [&page1, &page2, &page3] {
        for addr in page.iter() {
            assert!(!seen.contains(&addr), "distributor listed twice");
            seen.push(addr);
        }
    }
    assert_eq!(seen.len(), 5);
    for addr in &addrs {
        assert!(seen.contains(addr));
    }
}

#[test]
fn list_distributors_caps_the_limit_at_max_page_size() {
    let f = Fixture::new();
    f.client
        .set_max_distributors(&(MAX_DISTRIBUTOR_PAGE_SIZE + 10));
    for _ in 0..(MAX_DISTRIBUTOR_PAGE_SIZE + 5) {
        f.client.add_distributor(&Address::generate(&f.env));
    }

    // Requesting far more than the page cap must still be capped.
    let page = f.client.list_distributors(&0, &1_000);

    assert_eq!(page.len(), MAX_DISTRIBUTOR_PAGE_SIZE);
}

#[test]
fn list_distributors_out_of_range_cursor_returns_empty() {
    let f = Fixture::new();
    f.client.add_distributor(&Address::generate(&f.env));

    let result = f.client.list_distributors(&100, &10);

    assert_eq!(result.len(), 0);
}

#[test]
fn is_distributor_false_for_unknown_address() {
    let f = Fixture::new();
    let stranger = Address::generate(&f.env);
    assert!(!f.client.is_distributor(&stranger));
}
