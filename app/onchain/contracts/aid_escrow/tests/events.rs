//! Assert that AidEscrow emits the correct indexer-friendly events for each key transition.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, TryFromVal, Val, Vec,
};

const UNIT: i128 = 10_000_000; // 1.0 Token for 7-decimal assets

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

fn data_u64(env: &Env, data: &Val, field: &str) -> u64 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    u64::try_from_val(env, &val).expect("not u64")
}

fn data_i128(env: &Env, data: &Val, field: &str) -> i128 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    i128::try_from_val(env, &val).expect("not i128")
}

fn data_address(env: &Env, data: &Val, field: &str) -> Address {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    Address::try_from_val(env, &val).expect("not address")
}

fn data_symbol(env: &Env, data: &Val, field: &str) -> Symbol {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    Symbol::try_from_val(env, &val).expect("not symbol")
}

fn data_u64_vec(env: &Env, data: &Val, field: &str) -> std::vec::Vec<u64> {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    let vec_val = soroban_sdk::Vec::<Val>::try_from_val(env, &val).expect("not vec");
    let mut result = std::vec::Vec::new();
    for i in 0..vec_val.len() {
        let v = vec_val.get(i).unwrap();
        result.push(u64::try_from_val(env, &v).expect("not u64"));
    }
    result
}

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

    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let data = last_event_data(&env, &contract_id, "escrow_funded");
    assert_eq!(data_address(&env, &data, "from"), admin);
    assert_eq!(data_i128(&env, &data, "amount"), 5 * UNIT);
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
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let expires_at = env.ledger().timestamp() + 86400;
    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    let data = last_event_data(&env, &contract_id, "package_created");
    assert_eq!(data_u64(&env, &data, "package_id"), 42);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
    assert_eq!(data_address(&env, &data, "actor"), admin);
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
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );
    client.claim(&0u64);

    let data = last_event_data(&env, &contract_id, "package_claimed");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
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
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );
    client.disburse(&0u64);

    let data = last_event_data(&env, &contract_id, "package_disbursed");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
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
    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let pkg_id = 0u64;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );

    // ACTION: Ensure this matches your contract's function name (revoke vs cancel_package)
    client.revoke(&pkg_id);

    // TOPIC: Ensure this matches the first symbol in your env.events().publish(...) call
    let data = last_event_data(&env, &contract_id, "package_revoked");

    assert_eq!(data_u64(&env, &data, "package_id"), pkg_id);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
    assert_eq!(data_address(&env, &data, "actor"), admin);
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
    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let expires_at = env.ledger().timestamp() + 100;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    env.ledger().set_timestamp(expires_at + 1);
    client.refund(&0u64);

    let data = last_event_data(&env, &contract_id, "package_refunded");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
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
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let old_expires_at = env.ledger().timestamp() + 86400;
    let new_expires_at = old_expires_at + 600;
    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &old_expires_at,
        &Map::new(&env),
    );
    client.extend_expiry(&42u64, &new_expires_at);

    let data = last_event_data(&env, &contract_id, "extended_event");
    assert_eq!(data_u64(&env, &data, "package_id"), 42);
    assert_eq!(data_u64(&env, &data, "old_expires_at"), old_expires_at);
    assert_eq!(data_u64(&env, &data, "new_expires_at"), new_expires_at);
}

#[test]
fn test_batch_created_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let recipients = soroban_sdk::vec![&env, recipient1.clone(), recipient2.clone()];
    let amounts = soroban_sdk::vec![&env, UNIT, UNIT];
    let metadatas = soroban_sdk::vec![
        &env,
        Map::new(&env),
        Map::new(&env),
    ];
    client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &3600u64,
        &metadatas,
    );

    // The last event should be batch_created
    let data = last_event_data(&env, &contract_id, "batch_created");
    let ids = data_u64_vec(&env, &data, "ids");
    assert_eq!(ids.len(), 2);
    // IDs are auto-assigned starting from counter (0)
    assert_eq!(ids[0], 0u64);
    assert_eq!(ids[1], 1u64);
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_eq!(data_i128(&env, &data, "total_amount"), 2 * UNIT);
}

#[test]
fn test_surplus_withdrawn_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    // Withdraw surplus (nothing locked, so all 5 tokens are surplus)
    client.withdraw_surplus(&recipient, &UNIT, &token_client.address);

    let data = last_event_data(&env, &contract_id, "surplus_withdrawn");
    assert_eq!(data_address(&env, &data, "to"), recipient);
    assert_eq!(data_address(&env, &data, "token"), token_client.address);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
}

#[test]
fn test_contract_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();

    let data = last_event_data(&env, &contract_id, "contract_paused");
    assert_eq!(data_address(&env, &data, "admin"), admin);
}

#[test]
fn test_contract_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();
    let pause_data = last_event_data(&env, &contract_id, "contract_paused");
    assert_eq!(data_address(&env, &pause_data, "admin"), admin);

    client.unpause();
    let unpause_data = last_event_data(&env, &contract_id, "contract_unpaused");
    assert_eq!(data_address(&env, &unpause_data, "admin"), admin);
}

#[test]
fn test_action_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&Symbol::new(&env, "claim"));

    let data = last_event_data(&env, &contract_id, "action_paused");
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_eq!(data_symbol(&env, &data, "action"), Symbol::new(&env, "claim"));
}

#[test]
fn test_action_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&Symbol::new(&env, "claim"));
    client.unpause_action(&Symbol::new(&env, "claim"));

    let data = last_event_data(&env, &contract_id, "action_unpaused");
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_eq!(data_symbol(&env, &data, "action"), Symbol::new(&env, "claim"));
}

#[test]
fn test_all_package_events_include_package_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let expires_at = env.ledger().timestamp() + 86400;
    let pkg_id = 42u64;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    // verify package_created includes package_id
    let create_data = last_event_data(&env, &contract_id, "package_created");
    assert_field_exists(&env, &create_data, "package_id");

    // claim
    client.claim(&pkg_id);
    let claim_data = last_event_data(&env, &contract_id, "package_claimed");
    assert_field_exists(&env, &claim_data, "package_id");

    // create another package for revoke/refund tests
    let pkg_id2 = 43u64;
    client.create_package(
        &admin,
        &pkg_id2,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );

    // verify revoke
    client.revoke(&pkg_id2);
    let revoke_data = last_event_data(&env, &contract_id, "package_revoked");
    assert_field_exists(&env, &revoke_data, "package_id");

    // create another for refund
    let expires_at2 = env.ledger().timestamp() + 100;
    let pkg_id3 = 44u64;
    client.create_package(
        &admin,
        &pkg_id3,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at2,
        &Map::new(&env),
    );

    env.ledger().set_timestamp(expires_at2 + 1);
    client.refund(&pkg_id3);
    let refund_data = last_event_data(&env, &contract_id, "package_refunded");
    assert_field_exists(&env, &refund_data, "package_id");

    // verify extend_expiry event includes package_id
    let pkg_id4 = 45u64;
    client.create_package(
        &admin,
        &pkg_id4,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &Map::new(&env),
    );
    client.extend_expiry(&pkg_id4, &(expires_at + 600));
    let ext_data = last_event_data(&env, &contract_id, "extended_event");
    assert_field_exists(&env, &ext_data, "package_id");
}
