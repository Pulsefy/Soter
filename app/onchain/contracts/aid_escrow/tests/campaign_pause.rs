//! Tests for campaign-level pause controls.
//!
//! A campaign is identified by the `campaign_ref` metadata value shared by a
//! group of packages. These tests verify that campaign pause blocks claim,
//! disburse, and refund only for packages tagged with the paused campaign,
//! and that it interacts correctly with global and action-level pause.

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Symbol, TryFromVal,
};

const UNIT: i128 = 10_000_000; // 1.0 Token for 7-decimal assets

fn sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

struct Fixture {
    env: Env,
    client: AidEscrowClient<'static>,
    admin: Address,
    recipient: Address,
    token: TokenClient<'static>,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token, token_admin) = setup_token(&env, &admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin.mint(&admin, &(20 * UNIT));
    client.fund(&token.address, &admin, &(20 * UNIT));

    Fixture {
        env,
        client,
        admin,
        recipient,
        token,
    }
}

fn metadata_with_campaign(f: &Fixture, campaign_ref: &str) -> Map<Symbol, String> {
    let mut metadata = Map::new(&f.env);
    metadata.set(
        sym(&f.env, "campaign_ref"),
        String::from_str(&f.env, campaign_ref),
    );
    metadata
}

fn create_package_for_campaign(f: &Fixture, id: u64, campaign_ref: &str, expires_at: u64) -> u64 {
    f.client.create_package(
        &f.admin,
        &id,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &expires_at,
        &metadata_with_campaign(f, campaign_ref),
    )
}

fn last_event_symbol(f: &Fixture, topic: &str) -> Symbol {
    let expected = sym(&f.env, topic);
    for (_, topics, _) in f.env.events().all().iter().rev() {
        if let Some(first) = topics.first() {
            if let Ok(s) = Symbol::try_from_val(&f.env, &first) {
                if s == expected {
                    return s;
                }
            }
        }
    }
    panic!("expected event with topic '{}'", topic);
}

#[test]
fn test_campaign_pause_blocks_claim() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    f.client.pause_campaign(&String::from_str(&f.env, "camp-a"));

    let result = f.client.try_claim(&0u64);
    assert!(result.is_err());
    assert!(f
        .client
        .is_campaign_paused(&String::from_str(&f.env, "camp-a")));
}

#[test]
fn test_campaign_pause_does_not_block_other_campaign() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);
    create_package_for_campaign(&f, 1, "camp-b", expires_at);

    f.client.pause_campaign(&String::from_str(&f.env, "camp-a"));

    assert!(f.client.try_claim(&0u64).is_err());
    assert!(f.client.try_claim(&1u64).is_ok());
}

#[test]
fn test_unpause_campaign_resumes_claim() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    let campaign_ref = String::from_str(&f.env, "camp-a");
    f.client.pause_campaign(&campaign_ref);
    f.client.unpause_campaign(&campaign_ref);

    assert!(!f.client.is_campaign_paused(&campaign_ref));
    assert!(f.client.try_claim(&0u64).is_ok());
}

#[test]
fn test_campaign_pause_blocks_disburse() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    f.client.pause_campaign(&String::from_str(&f.env, "camp-a"));

    let result = f.client.try_disburse(&0u64);
    assert!(result.is_err());
}

#[test]
fn test_unpause_campaign_resumes_disburse() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    let campaign_ref = String::from_str(&f.env, "camp-a");
    f.client.pause_campaign(&campaign_ref);
    f.client.unpause_campaign(&campaign_ref);

    assert!(f.client.try_disburse(&0u64).is_ok());
}

#[test]
fn test_campaign_pause_blocks_refund() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 100;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);
    // Advance past expiry so the package is refundable.
    f.env.ledger().set_timestamp(expires_at + 1);

    f.client.pause_campaign(&String::from_str(&f.env, "camp-a"));

    let result = f.client.try_refund(&0u64);
    assert!(result.is_err());
}

#[test]
fn test_unpause_campaign_resumes_refund() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 100;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);
    f.env.ledger().set_timestamp(expires_at + 1);

    let campaign_ref = String::from_str(&f.env, "camp-a");
    f.client.pause_campaign(&campaign_ref);
    f.client.unpause_campaign(&campaign_ref);

    let result = f.client.try_refund(&0u64);
    assert!(result.is_ok());
}

#[test]
fn test_untagged_package_unaffected_by_campaign_pause() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    // No campaign_ref metadata at all.
    f.client.create_package(
        &f.admin,
        &0u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &expires_at,
        &Map::new(&f.env),
    );

    f.client.pause_campaign(&String::from_str(&f.env, "camp-a"));

    assert!(f.client.try_claim(&0u64).is_ok());
}

#[test]
fn test_global_pause_takes_precedence_over_campaign_state() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    // Campaign was never explicitly paused, but the global pause must still
    // block the campaign-scoped package, and is_campaign_paused must reflect
    // that global state.
    f.client.pause();

    assert!(f.client.try_claim(&0u64).is_err());
    assert!(f
        .client
        .is_campaign_paused(&String::from_str(&f.env, "camp-a")));

    f.client.unpause();
    assert!(f.client.try_claim(&0u64).is_ok());
}

#[test]
fn test_action_pause_blocks_campaign_package_independently_of_campaign_state() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    // Action-level pause blocks claim even though the campaign itself was
    // never paused.
    f.client.pause_action(&sym(&f.env, "claim"));
    assert!(f.client.try_claim(&0u64).is_err());
    assert!(!f
        .client
        .is_campaign_paused(&String::from_str(&f.env, "camp-a")));

    f.client.unpause_action(&sym(&f.env, "claim"));
    assert!(f.client.try_claim(&0u64).is_ok());
}

#[test]
fn test_campaign_pause_blocks_claim_even_when_action_unpaused() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 86400;
    create_package_for_campaign(&f, 0, "camp-a", expires_at);

    // Action-level claim pause is off, but the campaign is paused directly.
    let campaign_ref = String::from_str(&f.env, "camp-a");
    f.client.pause_campaign(&campaign_ref);

    assert!(f.client.try_claim(&0u64).is_err());
}

#[test]
fn test_campaign_paused_emits_event() {
    let f = setup();
    let campaign_ref = String::from_str(&f.env, "camp-a");
    f.client.pause_campaign(&campaign_ref);
    let _ = last_event_symbol(&f, "campaign_paused_event");

    f.client.unpause_campaign(&campaign_ref);
    let _ = last_event_symbol(&f, "campaign_unpaused_event");
}

#[test]
fn test_is_campaign_paused_default_false() {
    let f = setup();
    assert!(!f
        .client
        .is_campaign_paused(&String::from_str(&f.env, "never-paused")));
}
