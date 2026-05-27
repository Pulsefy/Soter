//! Event Schema Audit & Snapshot Tests for Indexers (Testnet).
//!
//! ## Audit Results
//!
//! ### 1. Stable Identifiers
//! Every package-related event carries a stable package ID:
//! - `PackageCreated`     → `package_id`
//! - `PackageClaimed`     → `package_id`
//! - `PackageDisbursed`   → `package_id`
//! - `PackageRevoked`     → `package_id`
//! - `PackageRefunded`    → `package_id`
//! - `BatchCreatedEvent`  → `ids` (Vec<u64>)
//! - `ExtendedEvent`      → `id`
//!
//! Non-package events (`EscrowFunded`, `SurplusWithdrawnEvent`,
//! `ContractPausedEvent`, etc.) are intentionally identifier-free.
//! No campaign reference exists on-chain (campaign is a backend concept).
//!
//! ### 2. Sensitive Metadata
//! All event payloads contain only public blockchain data:
//! addresses, amounts, timestamps, and status identifiers.
//! No private keys, PII, or secret metadata is emitted.
//!
//! ### 3. Event Topic Convention
//! Topic = struct name in snake_case (e.g. `package_created`).
//! Topics are single-symbol (first element in topics Vec).
//! Do not rename without versioning — indexers depend on stable topics.

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

/// Returns the first topic symbol of the last event matching `topic`.
fn last_event_topic(env: &Env, contract_id: &Address, topic: &str) -> Symbol {
    let expected = sym(env, topic);
    let events = contract_events(env, contract_id);
    for (_, topics, _) in events.iter().rev() {
        if let Some(first) = topics.first() {
            if let Ok(s) = Symbol::try_from_val(env, &first) {
                if s == expected {
                    return s;
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

fn assert_field_exists(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    assert!(
        map.get(sym(env, field)).is_some(),
        "field '{}' missing from event data",
        field
    );
}

fn assert_field_type_u64(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    let _: u64 = u64::try_from_val(env, &val).expect("field is not u64");
}

fn assert_field_type_i128(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    let _: i128 = i128::try_from_val(env, &val).expect("field is not i128");
}

fn assert_field_type_address(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let val = map.get(sym(env, field)).expect("missing field");
    let _: Address = Address::try_from_val(env, &val).expect("field is not address");
}

/// Count how many events with the given topic were emitted.
fn count_events_by_topic(env: &Env, contract_id: &Address, topic: &str) -> usize {
    let expected = sym(env, topic);
    contract_events(env, contract_id)
        .iter()
        .filter(|(_, topics, _)| {
            if let Some(first) = topics.first() {
                if let Ok(s) = Symbol::try_from_val(env, &first) {
                    return s == expected;
                }
            }
            false
        })
        .count()
}

/// Assert that no contract events were emitted.
fn assert_no_events(env: &Env, contract_id: &Address) {
    let events = contract_events(env, contract_id);
    assert!(
        events.is_empty(),
        "expected no contract events, found {}",
        events.len()
    );
}

fn empty_metadata(env: &Env) -> Map<Symbol, soroban_sdk::String> {
    Map::new(env)
}

fn empty_metadatas(env: &Env, count: u32) -> Vec<Map<Symbol, soroban_sdk::String>> {
    let mut metadatas: Vec<Map<Symbol, soroban_sdk::String>> = Vec::new(env);
    for _ in 0..count {
        metadatas.push_back(Map::new(env));
    }
    metadatas
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
    assert_eq!(data_u64(&env, &data, "id"), 42);
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
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    let mut recipients = Vec::new(&env);
    recipients.push_back(recipient1.clone());
    recipients.push_back(recipient2.clone());
    let mut amounts = Vec::new(&env);
    amounts.push_back(UNIT);
    amounts.push_back(2 * UNIT);

    let ids = client.batch_create_packages(
        &admin,
        &recipients,
        &amounts,
        &token_client.address,
        &86400u64,
        &empty_metadatas(&env, 2),
    );

    // Verify individual PackageCreated events
    assert_eq!(
        count_events_by_topic(&env, &contract_id, "package_created"),
        2
    );

    // Verify batch event
    let batch_data = last_event_data(&env, &contract_id, "batch_created_event");
    let batch_topic = last_event_topic(&env, &contract_id, "batch_created_event");
    assert_eq!(batch_topic, sym(&env, "batch_created_event"));

    // Verify batch fields
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(&env, &batch_data).unwrap();
    assert_field_exists(&env, &batch_data, "admin");
    assert_field_exists(&env, &batch_data, "total_amount");
    let _admin: Address = data_address(&env, &batch_data, "admin");
    let total: i128 = data_i128(&env, &batch_data, "total_amount");
    assert_eq!(total, 3 * UNIT);

    // Verify ids vec is present in the batch event
    assert!(map.get(sym(&env, "ids")).is_some());
    assert_eq!(ids.len(), 2);
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
    // Mint and fund 10.0 tokens, then withdraw surplus
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    // No packages created so all funds are surplus
    client.withdraw_surplus(&recipient, &(5 * UNIT), &token_client.address);

    let data = last_event_data(&env, &contract_id, "surplus_withdrawn_event");
    let topic = last_event_topic(&env, &contract_id, "surplus_withdrawn_event");
    assert_eq!(topic, sym(&env, "surplus_withdrawn_event"));

    assert_eq!(data_address(&env, &data, "to"), recipient);
    assert_eq!(data_address(&env, &data, "token"), token_client.address);
    assert_eq!(data_i128(&env, &data, "amount"), 5 * UNIT);
}

#[test]
fn test_contract_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();

    let data = last_event_data(&env, &contract_id, "contract_paused_event");
    let topic = last_event_topic(&env, &contract_id, "contract_paused_event");
    assert_eq!(topic, sym(&env, "contract_paused_event"));
    assert_eq!(data_address(&env, &data, "admin"), admin);
}

#[test]
fn test_contract_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();
    client.unpause();

    let data = last_event_data(&env, &contract_id, "contract_unpaused_event");
    let topic = last_event_topic(&env, &contract_id, "contract_unpaused_event");
    assert_eq!(topic, sym(&env, "contract_unpaused_event"));
    assert_eq!(data_address(&env, &data, "admin"), admin);
}

#[test]
fn test_action_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&sym(&env, "create"));

    let data = last_event_data(&env, &contract_id, "action_paused_event");
    let topic = last_event_topic(&env, &contract_id, "action_paused_event");
    assert_eq!(topic, sym(&env, "action_paused_event"));
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_field_exists(&env, &data, "action");
}

#[test]
fn test_action_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&sym(&env, "claim"));
    client.unpause_action(&sym(&env, "claim"));

    let data = last_event_data(&env, &contract_id, "action_unpaused_event");
    let topic = last_event_topic(&env, &contract_id, "action_unpaused_event");
    assert_eq!(topic, sym(&env, "action_unpaused_event"));
    assert_eq!(data_address(&env, &data, "admin"), admin);
    assert_field_exists(&env, &data, "action");
}

#[test]
fn test_event_topics_include_package_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    // Create → Claim → Disburse: every package-related event must carry package_id
    let pkg_id = 99u64;
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );

    let created = last_event_data(&env, &contract_id, "package_created");
    assert_eq!(data_u64(&env, &created, "package_id"), pkg_id);

    client.claim(&pkg_id);
    let claimed = last_event_data(&env, &contract_id, "package_claimed");
    assert_eq!(data_u64(&env, &claimed, "package_id"), pkg_id);

    // Create another package for disbursed test
    let pkg_id2 = 100u64;
    client.create_package(
        &admin,
        &pkg_id2,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );
    client.disburse(&pkg_id2);
    let disbursed = last_event_data(&env, &contract_id, "package_disbursed");
    assert_eq!(data_u64(&env, &disbursed, "package_id"), pkg_id2);

    // Revoke a package
    let pkg_id3 = 101u64;
    client.create_package(
        &admin,
        &pkg_id3,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );
    client.revoke(&pkg_id3);
    let revoked = last_event_data(&env, &contract_id, "package_revoked");
    assert_eq!(data_u64(&env, &revoked, "package_id"), pkg_id3);

    // Create an expired package and refund it
    let pkg_id4 = 102u64;
    let expires_at = env.ledger().timestamp() + 100;
    client.create_package(
        &admin,
        &pkg_id4,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &empty_metadata(&env),
    );
    env.ledger().set_timestamp(expires_at + 1);
    client.refund(&pkg_id4);
    let refunded = last_event_data(&env, &contract_id, "package_refunded");
    assert_eq!(data_u64(&env, &refunded, "package_id"), pkg_id4);
}

#[test]
fn test_no_events_on_failed_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // Claiming a non-existent package should fail and emit no contract events
    let result = client.try_claim(&999u64);
    assert!(result.is_err());
    assert_no_events(&env, &contract_id);

    // Revoking a non-existent package should fail and emit no events
    let result = client.try_revoke(&999u64);
    assert!(result.is_err());
    assert_no_events(&env, &contract_id);
}

#[test]
fn test_multiple_events_in_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    // Workflow: fund → create → claim
    let events_before = contract_events(&env, &contract_id).len();

    // Fund
    let fund_events_before = contract_events(&env, &contract_id).len();
    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));
    let fund_events_after = contract_events(&env, &contract_id).len();
    assert_eq!(
        fund_events_after - fund_events_before,
        1,
        "fund should emit exactly 1 contract event"
    );

    // Create
    let create_events_before = contract_events(&env, &contract_id).len();
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );
    let create_events_after = contract_events(&env, &contract_id).len();
    assert_eq!(
        create_events_after - create_events_before,
        1,
        "create_package should emit exactly 1 contract event"
    );

    // Claim (also triggers token transfer event from the token contract)
    let claim_events_before = contract_events(&env, &contract_id).len();
    client.claim(&0u64);
    let claim_events_after = contract_events(&env, &contract_id).len();
    assert_eq!(
        claim_events_after - claim_events_before,
        1,
        "claim should emit exactly 1 contract event"
    );

    // Total events from the contract should now be 3
    let all_events = contract_events(&env, &contract_id);
    assert_eq!(all_events.len(), events_before + 3);
}

#[test]
fn test_multiple_packages_separate_events() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    // Create two packages individually
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expires = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1u64,
        &r1,
        &UNIT,
        &token_client.address,
        &expires,
        &empty_metadata(&env),
    );
    client.create_package(
        &admin,
        &2u64,
        &r2,
        &(2 * UNIT),
        &token_client.address,
        &expires,
        &empty_metadata(&env),
    );

    // Each package should have its own PackageCreated event
    assert_eq!(
        count_events_by_topic(&env, &contract_id, "package_created"),
        2
    );

    // Each event should reference the correct package
    let events = contract_events(&env, &contract_id);
    let pkg_created_events: std::vec::Vec<_> = events
        .iter()
        .filter(|(_, topics, _)| {
            if let Some(first) = topics.first() {
                if let Ok(s) = Symbol::try_from_val(&env, &first) {
                    return s == sym(&env, "package_created");
                }
            }
            false
        })
        .collect();

    // First event: package_id=1, amount=UNIT
    let data1 = pkg_created_events[0].2;
    assert_eq!(data_u64(&env, &data1, "package_id"), 1);
    assert_eq!(data_i128(&env, &data1, "amount"), UNIT);

    // Second event: package_id=2, amount=2*UNIT
    let data2 = pkg_created_events[1].2;
    assert_eq!(data_u64(&env, &data2, "package_id"), 2);
    assert_eq!(data_i128(&env, &data2, "amount"), 2 * UNIT);
}

#[test]
fn test_package_cancelled_event() {
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

    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );

    // cancel_package emits PackageRevoked (same event as revoke)
    client.cancel_package(&0u64);

    let data = last_event_data(&env, &contract_id, "package_revoked");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
    assert_eq!(data_address(&env, &data, "recipient"), recipient);
    assert_eq!(data_i128(&env, &data, "amount"), UNIT);
    assert_eq!(data_address(&env, &data, "actor"), admin);
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_expired_event() {
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

    // Package with short expiry
    let expires_at = env.ledger().timestamp() + 100;
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &expires_at,
        &empty_metadata(&env),
    );

    // Try to claim after expiry → should fail with PackageExpired
    env.ledger().set_timestamp(expires_at + 1);
    let result = client.try_claim(&0u64);
    assert!(result.is_err());

    // The failed claim transitions the package to Expired status but does NOT emit an event
    // Refunding the expired package emits PackageRefunded
    client.refund(&0u64);

    let data = last_event_data(&env, &contract_id, "package_refunded");
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "timestamp");
    assert_eq!(data_u64(&env, &data, "package_id"), 0);
}

#[test]
fn test_event_payloads_no_sensitive_metadata() {
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

    // Create a package with metadata (metadata should NOT appear in events)
    let mut metadata = Map::new(&env);
    metadata.set(sym(&env, "note"), soroban_sdk::String::from_str(&env, "some-internal-note"));
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &metadata,
    );

    let data = last_event_data(&env, &contract_id, "package_created");

    // PackageCreated payload must NOT contain metadata or any unexpected fields
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(&env, &data).unwrap();

    // Allowed fields for PackageCreated
    let allowed = [
        sym(&env, "package_id"),
        sym(&env, "recipient"),
        sym(&env, "amount"),
        sym(&env, "actor"),
        sym(&env, "timestamp"),
    ];
    let keys: std::vec::Vec<Symbol> = map.keys().into_iter().collect();
    for k in keys.iter() {
        assert!(
            allowed.contains(k),
            "Unexpected field in PackageCreated event payload — potential sensitive data leak"
        );
    }

    // Verify expected field types
    assert_field_type_u64(&env, &data, "package_id");
    assert_field_type_address(&env, &data, "recipient");
    assert_field_type_i128(&env, &data, "amount");
    assert_field_type_address(&env, &data, "actor");
    assert_field_type_u64(&env, &data, "timestamp");

    // Verify NON-package events also have clean payloads
    client.pause();
    let pause_data = last_event_data(&env, &contract_id, "contract_paused_event");
    let pause_map = soroban_sdk::Map::<Symbol, Val>::try_from_val(&env, &pause_data).unwrap();
    let pause_keys: std::vec::Vec<Symbol> = pause_map.keys().into_iter().collect();
    assert_eq!(pause_keys.len(), 1, "ContractPausedEvent should have 1 field");
    assert_field_type_address(&env, &pause_data, "admin");
}

#[test]
fn test_all_event_topics_are_snake_case() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(10 * UNIT));

    // Run a multi-step workflow to collect all event topics
    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &empty_metadata(&env),
    );
    client.claim(&0u64);
    client.pause();
    client.unpause();
    client.pause_action(&sym(&env, "create"));
    client.unpause_action(&sym(&env, "create"));

    // Collect all unique topics
    let events = contract_events(&env, &contract_id);
    let mut seen_topics: std::vec::Vec<Symbol> = std::vec::Vec::new();
    for (_, topics, _) in events.iter() {
        if let Some(first) = topics.first() {
            if let Ok(s) = Symbol::try_from_val(&env, &first) {
                if !seen_topics.contains(&s) {
                    seen_topics.push(s);
                }
            }
        }
    }

    // Verify we captured the expected topics
    assert!(seen_topics.contains(&sym(&env, "escrow_funded")));
    assert!(seen_topics.contains(&sym(&env, "package_created")));
    assert!(seen_topics.contains(&sym(&env, "package_claimed")));
    assert!(seen_topics.contains(&sym(&env, "contract_paused_event")));
    assert!(seen_topics.contains(&sym(&env, "contract_unpaused_event")));
    assert!(seen_topics.contains(&sym(&env, "action_paused_event")));
    assert!(seen_topics.contains(&sym(&env, "action_unpaused_event")));
}
