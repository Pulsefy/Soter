//! Assert that AidEscrow emits the correct indexer-friendly events for each key transition.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, TryFromVal, Val, Vec,
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

/// Returns events emitted by the given contract.
fn contract_events(env: &Env, contract_id: &Address) -> std::vec::Vec<(Address, Vec<Val>, Val)> {
    env.events()
        .all()
        .into_iter()
        .filter(|(id, _, _)| id == contract_id)
        .collect()
}

/// Finds the last event with the given topic symbol and returns its data Val.
fn last_event_data(env: &Env, contract_id: &Address, topic: &str) -> Val {
    let expected = sym(env, topic);
    let events = contract_events(env, contract_id);
    for (_, topics, data) in events.iter().rev() {
        if let Some(first) = topics.first() {
            if let Ok(s) = Symbol::try_from_val(env, &first) {
                if s == expected {
                    return *data;
                }
            }
        }
    }
    panic!(
        "expected event with topic '{}', found {} contract events",
        topic,
        events.len()
    );
}

/// Extract a u64 field from an event data map.
fn data_u64(env: &Env, data: &Val, field: &str) -> u64 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    u64::try_from_val(env, &val).expect("not u64")
}

/// Extract an i128 field from an event data map.
fn data_i128(env: &Env, data: &Val, field: &str) -> i128 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    i128::try_from_val(env, &val).expect("not i128")
}

/// Extract an Address field from an event data map.
fn data_address(env: &Env, data: &Val, field: &str) -> Address {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    Address::try_from_val(env, &val).expect("not address")
}

/// Assert a u64 field exists in the event data (without checking value).
fn assert_field_exists(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    assert!(
        map.get(sym(env, field)).is_some(),
        "field '{}' missing from event data",
        field
    );
}

#[test]
fn test_escrow_funded_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let data = last_event_data(&env, &contract_id, "escrow_funded");
    assert_eq!(data_address(&env, &data, "from"), admin);
    assert_eq!(data_i128(&env, &data, "amount"), 5000);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_created_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let expires_at = env.ledger().timestamp() + 86400;
    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
        &metadata,
    );

    let data = last_event_data(&env, &contract_id, "package_created");
    assert_eq!(data_u64(&env, &data, "package_id"), 42);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), 1000);
    assert_eq!(data_address(&env, &data, "actor"), admin);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_claimed_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let expires_at = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );
    client.claim(&0u64);

    let data = last_event_data(&env, &contract_id, "package_claimed");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), 1000);
    assert_eq!(data_address(&env, &data, "actor"), recipient);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_disbursed_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let expires_at = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );
    client.disburse(&0u64);

    let data = last_event_data(&env, &contract_id, "package_disbursed");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), 1000);
    assert_eq!(data_address(&env, &data, "actor"), admin);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_revoked_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let expires_at = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );
    client.revoke(&0u64);

    let data = last_event_data(&env, &contract_id, "package_revoked");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), 1000);
    assert_eq!(data_address(&env, &data, "actor"), admin);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_refunded_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let expires_at = env.ledger().timestamp() + 1;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &1000,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    env.ledger().set_timestamp(env.ledger().timestamp() + 2);
    client.refund(&0u64);

    let data = last_event_data(&env, &contract_id, "package_refunded");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), 1000);
    assert_eq!(data_address(&env, &data, "actor"), admin);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_extended_event_records_old_and_new_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &10_000);
    client.fund(&token_client.address, &admin, &5000);

    let old_expires_at = env.ledger().timestamp() + 86400;
    let new_expires_at = old_expires_at + 600;
    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &1000,
        &token_client.address,
        &old_expires_at,
        &Map::new(&env),
    );
    client.extend_expiry(&42u64, &new_expires_at);

    let data = last_event_data(&env, &contract_id, "extended_event");
    assert_eq!(data_u64(&env, &data, "id"), 42);
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_eq!(data_u64(&env, &data, "old_expires_at"), old_expires_at);
    assert_eq!(data_u64(&env, &data, "new_expires_at"), new_expires_at);
}
