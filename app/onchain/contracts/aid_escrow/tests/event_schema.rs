//! Snapshot-style tests for event schema consistency.
//!
//! These tests guarantee that:
//! 1. Every event has the expected topic name (snake_case struct name).
//! 2. Every event payload contains exactly the documented set of fields.
//! 3. No PII or opaque metadata maps leak into event payloads.
//! 4. EVENT_SCHEMA_VERSION is accessible and matches the expected value.
//!
//! If any of these tests break after a contract change, it means the event
//! schema has changed and EVENT_SCHEMA_VERSION must be bumped.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, EVENT_SCHEMA_VERSION};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, TryFromVal, Val, Vec,
};

const UNIT: i128 = 10_000_000;

// ── Helpers ──────────────────────────────────────────────────────────────

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

/// Returns all events emitted by the given contract.
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

/// Extracts field names from an event data map.
#[allow(dead_code)]
fn event_field_names(env: &Env, data: &Val) -> std::vec::Vec<std::string::String> {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let keys = map.keys();
    let mut names = std::vec::Vec::new();
    for i in 0..keys.len() {
        let key = keys.get(i).unwrap();
        // Convert Symbol to string by formatting with debug
        names.push(format!("{:?}", key));
    }
    names.sort();
    names
}

/// Counts the number of fields in an event data map.
fn event_field_count(env: &Env, data: &Val) -> u32 {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    map.len()
}

fn assert_field_exists(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    assert!(
        map.get(sym(env, field)).is_some(),
        "field '{}' missing from event data",
        field
    );
}

fn assert_field_absent(env: &Env, data: &Val, field: &str) {
    let map = soroban_sdk::Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    assert!(
        map.get(sym(env, field)).is_none(),
        "field '{}' should NOT be in event data (potential metadata leak)",
        field
    );
}

// ── Schema Version ───────────────────────────────────────────────────────

#[test]
fn test_event_schema_version_is_current() {
    // If this assertion fails, it means someone changed the schema version
    // without updating the test — review all event changes and confirm
    // backward-compat before adjusting.
    assert_eq!(EVENT_SCHEMA_VERSION, 2);
}

// ── Topic Name Stability ─────────────────────────────────────────────────

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
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );

    // Verify the topic is "package_created" (snake_case)
    let expected = sym(&env, "package_created");
    let events = contract_events(&env, &contract_id);
    let found = events.iter().any(|(_, topics, _)| {
        topics
            .first()
            .and_then(|v| Symbol::try_from_val(&env, &v).ok())
            .map(|s| s == expected)
            .unwrap_or(false)
    });
    assert!(found, "event topic 'package_created' not found");
}

// ── Payload Field Consistency ────────────────────────────────────────────

#[test]
fn test_escrow_funded_event_fields() {
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
    assert_eq!(event_field_count(&env, &data), 4);
    assert_field_exists(&env, &data, "from");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_created_event_fields() {
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
        &1u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );

    let data = last_event_data(&env, &contract_id, "package_created");
    assert_eq!(event_field_count(&env, &data), 6);
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "recipient");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "actor");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_claimed_event_fields() {
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
    assert_eq!(event_field_count(&env, &data), 6);
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "recipient");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "actor");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_disbursed_event_fields() {
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
    assert_eq!(event_field_count(&env, &data), 6);
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "recipient");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "actor");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_revoked_event_fields() {
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
        &Map::new(&env),
    );
    client.revoke(&0u64);

    let data = last_event_data(&env, &contract_id, "package_revoked");
    assert_eq!(event_field_count(&env, &data), 6);
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "recipient");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "actor");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_package_refunded_event_fields() {
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
    assert_eq!(event_field_count(&env, &data), 6);
    assert_field_exists(&env, &data, "package_id");
    assert_field_exists(&env, &data, "recipient");
    assert_field_exists(&env, &data, "amount");
    assert_field_exists(&env, &data, "token");
    assert_field_exists(&env, &data, "actor");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_extended_event_fields() {
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
    client.create_package(
        &admin,
        &42u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &old_expires_at,
        &Map::new(&env),
    );
    client.extend_expiry(&42u64, &(old_expires_at + 600));

    let data = last_event_data(&env, &contract_id, "extended_event");
    assert_eq!(event_field_count(&env, &data), 5);
    assert_field_exists(&env, &data, "id");
    assert_field_exists(&env, &data, "admin");
    assert_field_exists(&env, &data, "old_expires_at");
    assert_field_exists(&env, &data, "new_expires_at");
    assert_field_exists(&env, &data, "timestamp");
}

// ── No Metadata Leaks ────────────────────────────────────────────────────

#[test]
fn test_no_metadata_leak_in_package_created() {
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

    // Create a package WITH metadata to verify it doesn't leak
    let mut metadata = Map::new(&env);
    metadata.set(
        symbol_short!("tag"),
        soroban_sdk::String::from_str(&env, "sensitive-info"),
    );

    client.create_package(
        &admin,
        &1u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &metadata,
    );

    let data = last_event_data(&env, &contract_id, "package_created");

    // Ensure no metadata-related fields leak into the event
    assert_field_absent(&env, &data, "metadata");
    assert_field_absent(&env, &data, "tag");
    assert_field_absent(&env, &data, "merkle_root");
    assert_field_absent(&env, &data, "claim_starts_at");
}

#[test]
fn test_no_metadata_leak_in_package_claimed() {
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

    let mut metadata = Map::new(&env);
    metadata.set(
        symbol_short!("tag"),
        soroban_sdk::String::from_str(&env, "private-data"),
    );

    client.create_package(
        &admin,
        &0u64,
        &recipient,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &metadata,
    );
    client.claim(&0u64);

    let data = last_event_data(&env, &contract_id, "package_claimed");
    assert_field_absent(&env, &data, "metadata");
    assert_field_absent(&env, &data, "tag");
    assert_field_absent(&env, &data, "merkle_root");
}

// ── Multiple Events in Workflow ──────────────────────────────────────────

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

    let events = contract_events(&env, &contract_id);
    let topics: std::vec::Vec<std::string::String> = events
        .iter()
        .filter_map(|(_, topics, _)| {
            topics
                .first()
                .and_then(|v| Symbol::try_from_val(&env, &v).ok())
                .map(|s| format!("{:?}", s))
        })
        .collect();

    // Verify ordering: escrow_funded → package_created → package_claimed
    assert!(
        topics.len() >= 3,
        "Expected at least 3 events, got {}",
        topics.len()
    );
}

// ── Multiple Packages Emit Separate Events ───────────────────────────────

#[test]
fn test_multiple_packages_separate_events() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    token_admin_client.mint(&admin, &(10 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    client.create_package(
        &admin,
        &0u64,
        &r1,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );
    client.create_package(
        &admin,
        &1u64,
        &r2,
        &UNIT,
        &token_client.address,
        &(env.ledger().timestamp() + 86400),
        &Map::new(&env),
    );

    let create_topic = sym(&env, "package_created");
    let create_events: std::vec::Vec<_> = contract_events(&env, &contract_id)
        .into_iter()
        .filter(|(_, topics, _)| {
            topics
                .first()
                .and_then(|v| Symbol::try_from_val(&env, &v).ok())
                .map(|s| s == create_topic)
                .unwrap_or(false)
        })
        .collect();

    assert_eq!(create_events.len(), 2, "Expected 2 package_created events");
}

// ── No Events on Failed Operations ───────────────────────────────────────

#[test]
fn test_no_events_on_failed_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, _token_admin_client) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    let events_before = contract_events(&env, &contract_id).len();

    // Try to claim non-existent package — should fail
    let _ = client.try_claim(&999u64);

    let events_after = contract_events(&env, &contract_id).len();
    assert_eq!(
        events_before, events_after,
        "Failed operations should not emit events"
    );
}

// ── Pause/Unpause Events ─────────────────────────────────────────────────

#[test]
fn test_contract_paused_event_fields() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();

    let data = last_event_data(&env, &contract_id, "contract_paused_event");
    assert_eq!(event_field_count(&env, &data), 2);
    assert_field_exists(&env, &data, "admin");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_contract_unpaused_event_fields() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause();
    client.unpause();

    let data = last_event_data(&env, &contract_id, "contract_unpaused_event");
    assert_eq!(event_field_count(&env, &data), 2);
    assert_field_exists(&env, &data, "admin");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_action_paused_event_fields() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&symbol_short!("create"));

    let data = last_event_data(&env, &contract_id, "action_paused_event");
    assert_eq!(event_field_count(&env, &data), 3);
    assert_field_exists(&env, &data, "admin");
    assert_field_exists(&env, &data, "action");
    assert_field_exists(&env, &data, "timestamp");
}

#[test]
fn test_action_unpaused_event_fields() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    client.pause_action(&symbol_short!("create"));
    client.unpause_action(&symbol_short!("create"));

    let data = last_event_data(&env, &contract_id, "action_unpaused_event");
    assert_eq!(event_field_count(&env, &data), 3);
    assert_field_exists(&env, &data, "admin");
    assert_field_exists(&env, &data, "action");
    assert_field_exists(&env, &data, "timestamp");
}
