//! Tests for action-specific pause controls (create, claim, refund, withdraw).

#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, TryFromVal,
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

    token_admin.mint(&admin, &(10 * UNIT));
    client.fund(&token.address, &admin, &(10 * UNIT));

    Fixture {
        env,
        client,
        admin,
        recipient,
        token,
    }
}

fn create_package(f: &Fixture) -> u64 {
    f.client.create_package(
        &f.admin,
        &0u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &(f.env.ledger().timestamp() + 86400),
        &Map::new(&f.env),
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
fn test_pause_blocks_create() {
    let f = setup();
    f.client.pause_action(&sym(&f.env, "create"));

    let result = f.client.try_create_package(
        &f.admin,
        &1u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &(f.env.ledger().timestamp() + 86400),
        &Map::new(&f.env),
    );
    assert!(result.is_err());

    // is_action_paused reflects the paused state
    assert!(f.client.is_action_paused(&sym(&f.env, "create")));
}

#[test]
fn test_unpause_resumes_create() {
    let f = setup();
    f.client.pause_action(&sym(&f.env, "create"));
    f.client.unpause_action(&sym(&f.env, "create"));

    assert!(!f.client.is_action_paused(&sym(&f.env, "create")));

    let result = f.client.try_create_package(
        &f.admin,
        &1u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &(f.env.ledger().timestamp() + 86400),
        &Map::new(&f.env),
    );
    assert!(result.is_ok());
}

#[test]
fn test_pause_blocks_claim() {
    let f = setup();
    create_package(&f);
    f.client.pause_action(&sym(&f.env, "claim"));

    let result = f.client.try_claim(&0u64);
    assert!(result.is_err());

    assert!(f.client.is_action_paused(&sym(&f.env, "claim")));
}

#[test]
fn test_unpause_resumes_claim() {
    let f = setup();
    create_package(&f);
    f.client.pause_action(&sym(&f.env, "claim"));
    f.client.unpause_action(&sym(&f.env, "claim"));

    let result = f.client.try_claim(&0u64);
    assert!(result.is_ok());
}

#[test]
fn test_pause_blocks_refund() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 100;
    f.client.create_package(
        &f.admin,
        &0u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &expires_at,
        &Map::new(&f.env),
    );
    // Advance past expiry so the package is refundable.
    f.env.ledger().set_timestamp(expires_at + 1);

    f.client.pause_action(&sym(&f.env, "refund"));

    let result = f.client.try_refund(&0u64);
    assert!(result.is_err());

    assert!(f.client.is_action_paused(&sym(&f.env, "refund")));
}

#[test]
fn test_unpause_resumes_refund() {
    let f = setup();
    let expires_at = f.env.ledger().timestamp() + 100;
    f.client.create_package(
        &f.admin,
        &0u64,
        &f.recipient,
        &UNIT,
        &f.token.address,
        &expires_at,
        &Map::new(&f.env),
    );
    f.env.ledger().set_timestamp(expires_at + 1);

    f.client.pause_action(&sym(&f.env, "refund"));
    f.client.unpause_action(&sym(&f.env, "refund"));

    let result = f.client.try_refund(&0u64);
    assert!(result.is_ok());
}

#[test]
fn test_pause_blocks_withdraw() {
    let f = setup();
    f.client.pause_action(&sym(&f.env, "withdraw"));

    let result = f
        .client
        .try_withdraw_surplus(&f.recipient, &UNIT, &f.token.address);
    assert!(result.is_err());

    assert!(f.client.is_action_paused(&sym(&f.env, "withdraw")));
}

#[test]
fn test_unpause_resumes_withdraw() {
    let f = setup();
    f.client.pause_action(&sym(&f.env, "withdraw"));
    f.client.unpause_action(&sym(&f.env, "withdraw"));

    let result = f
        .client
        .try_withdraw_surplus(&f.recipient, &UNIT, &f.token.address);
    assert!(result.is_ok());
}

#[test]
fn test_action_paused_emits_event() {
    let f = setup();
    f.client.pause_action(&sym(&f.env, "refund"));
    let _ = last_event_symbol(&f, "action_paused_event");

    f.client.unpause_action(&sym(&f.env, "refund"));
    let _ = last_event_symbol(&f, "action_unpaused_event");
}

#[test]
fn test_global_pause_blocks_actions() {
    let f = setup();
    create_package(&f);
    f.client.pause();

    // Contract-wide pause must block every action-specific path.
    assert!(f
        .client
        .try_create_package(
            &f.admin,
            &1u64,
            &f.recipient,
            &UNIT,
            &f.token.address,
            &(f.env.ledger().timestamp() + 86400),
            &Map::new(&f.env),
        )
        .is_err());
    assert!(f.client.try_claim(&0u64).is_err());
    assert!(f
        .client
        .try_withdraw_surplus(&f.recipient, &UNIT, &f.token.address)
        .is_err());

    f.client.unpause();
    assert!(f.client.try_claim(&0u64).is_ok());
}
