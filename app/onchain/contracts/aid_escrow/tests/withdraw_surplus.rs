#![cfg(test)]

//! Timelock coverage for the propose -> execute surplus withdrawal flow
//! (see #968: a single-step `withdraw_surplus` gave a compromised admin key
//! no observation window before funds moved). These tests exercise the full
//! lifecycle — propose, cancel, execute — plus the boundary timing around
//! the configurable delay.

use aid_escrow::{AidEscrow, AidEscrowClient, Error};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

// We still use UNIT for funding to keep our test math clean
const UNIT: i128 = 10_000_000;
const DEFAULT_DELAY: u64 = 86400;

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

fn setup_funded(
    env: &Env,
    fund_tokens: i128,
) -> (
    AidEscrowClient<'static>,
    TokenClient<'static>,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_client, token_admin_client) = setup_token(env, &token_admin);

    let contract_address = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(env, &contract_address);

    client.init(&admin);

    if fund_tokens > 0 {
        let amount = fund_tokens * UNIT;
        token_admin_client.mint(&admin, &amount);
        env.mock_all_auths();
        client.fund(&token_client.address, &admin, &amount);
    }

    (client, token_client, admin, token_admin)
}

fn advance_time(env: &Env, seconds: u64) {
    let mut info = env.ledger().get();
    info.timestamp += seconds;
    env.ledger().set(info);
}

#[test]
fn test_propose_surplus_withdrawal_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 5);

    let res_zero = client.try_propose_surplus_withdrawal(&admin, &0, &token_client.address);
    assert_eq!(res_zero, Err(Ok(Error::InvalidAmount)));

    let res_neg = client.try_propose_surplus_withdrawal(&admin, &-UNIT, &token_client.address);
    assert_eq!(res_neg, Err(Ok(Error::InvalidAmount)));

    assert_eq!(client.get_pending_surplus_withdrawal(), None);
}

#[test]
fn test_propose_surplus_withdrawal_insufficient_surplus() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 10);
    let recipient = Address::generate(&env);

    client.create_package(
        &admin,
        &1,
        &recipient,
        &(8 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 1000),
        &Map::new(&env),
    );

    // Balance 10, Locked 8, Surplus 2. Request 3.
    let result = client.try_propose_surplus_withdrawal(&admin, &(3 * UNIT), &token_client.address);
    assert_eq!(result, Err(Ok(Error::InsufficientSurplus)));
    assert_eq!(client.get_pending_surplus_withdrawal(), None);
}

#[test]
fn test_propose_records_pending_withdrawal_with_default_delay() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);
    let now = env.ledger().timestamp();

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);

    let pending = client.get_pending_surplus_withdrawal().unwrap();
    assert_eq!(pending.to, admin);
    assert_eq!(pending.amount, UNIT);
    assert_eq!(pending.token, token_client.address);
    assert_eq!(pending.unlock_time, now + DEFAULT_DELAY);

    // Funds must not move until the proposal is executed.
    assert_eq!(token_client.balance(&client.address), UNIT);
}

#[test]
fn test_execute_before_delay_elapses_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);

    let result = client.try_execute_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::TimelockNotElapsed)));
    assert_eq!(token_client.balance(&client.address), UNIT);
}

#[test]
fn test_execute_one_second_before_unlock_time_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    advance_time(&env, DEFAULT_DELAY - 1);

    let result = client.try_execute_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::TimelockNotElapsed)));
}

#[test]
fn test_execute_exactly_at_unlock_time_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    advance_time(&env, DEFAULT_DELAY);

    client.execute_surplus_withdrawal();

    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(token_client.balance(&admin), UNIT);
    assert_eq!(client.get_pending_surplus_withdrawal(), None);
}

#[test]
fn test_execute_after_delay_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    advance_time(&env, DEFAULT_DELAY + 1);

    client.execute_surplus_withdrawal();

    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(token_client.balance(&admin), UNIT);
}

#[test]
fn test_execute_revalidates_surplus_at_execution_time() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 10);
    let recipient = Address::generate(&env);

    // Surplus is 10 at proposal time, so proposing 6 succeeds.
    client.propose_surplus_withdrawal(&admin, &(6 * UNIT), &token_client.address);

    // Before the timelock elapses, a new package locks up 8 of the 10,
    // leaving only 2 available — no longer enough for the proposal.
    client.create_package(
        &admin,
        &1,
        &recipient,
        &(8 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 1000),
        &Map::new(&env),
    );
    advance_time(&env, DEFAULT_DELAY);

    let result = client.try_execute_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::InsufficientSurplus)));

    // The proposal is left in place; the admin can retry once locked funds free up.
    assert!(client.get_pending_surplus_withdrawal().is_some());
}

#[test]
fn test_execute_with_no_pending_withdrawal_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _token_client, _admin, _) = setup_funded(&env, 1);

    let result = client.try_execute_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::NoPendingWithdrawal)));
}

#[test]
fn test_cancel_surplus_withdrawal_removes_pending_and_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    assert!(client.get_pending_surplus_withdrawal().is_some());

    client.cancel_surplus_withdrawal();
    assert_eq!(client.get_pending_surplus_withdrawal(), None);

    advance_time(&env, DEFAULT_DELAY);
    let result = client.try_execute_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::NoPendingWithdrawal)));
    assert_eq!(token_client.balance(&client.address), UNIT);
}

#[test]
fn test_cancel_with_no_pending_withdrawal_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _token_client, _admin, _) = setup_funded(&env, 1);

    let result = client.try_cancel_surplus_withdrawal();
    assert_eq!(result, Err(Ok(Error::NoPendingWithdrawal)));
}

#[test]
fn test_propose_overwrites_existing_pending_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 5);
    let other_recipient = Address::generate(&env);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    advance_time(&env, 100);
    client.propose_surplus_withdrawal(&other_recipient, &(2 * UNIT), &token_client.address);

    let pending = client.get_pending_surplus_withdrawal().unwrap();
    assert_eq!(pending.to, other_recipient);
    assert_eq!(pending.amount, 2 * UNIT);
    assert_eq!(pending.unlock_time, env.ledger().timestamp() + DEFAULT_DELAY);
}

#[test]
fn test_set_surplus_withdrawal_delay_applies_to_new_proposals() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _) = setup_funded(&env, 1);

    assert_eq!(client.get_surplus_withdrawal_delay(), DEFAULT_DELAY);

    client.set_surplus_withdrawal_delay(&0);
    assert_eq!(client.get_surplus_withdrawal_delay(), 0);

    client.propose_surplus_withdrawal(&admin, &UNIT, &token_client.address);
    // Delay of zero: no need to advance the ledger before executing.
    client.execute_surplus_withdrawal();

    assert_eq!(token_client.balance(&client.address), 0);
    assert_eq!(token_client.balance(&admin), UNIT);
}
