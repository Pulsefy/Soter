#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PendingWithdrawal, SURPLUS_WITHDRAWAL_DELAY_SECS};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

/// Creates and funds an escrow contract. Returns (client, token, admin, _token_admin).
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

/// Advances the simulated ledger clock by `secs` seconds.
fn advance_time(env: &Env, secs: u64) {
    let new_time = env.ledger().timestamp() + secs;
    env.ledger().set_timestamp(new_time);
}

// ---------------------------------------------------------------------------
// propose_surplus_withdrawal — validation errors
// ---------------------------------------------------------------------------

#[test]
fn propose_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    let res = client.try_propose_surplus_withdrawal(&to, &0, &token_client.address);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn propose_rejects_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    let res = client.try_propose_surplus_withdrawal(&to, &(-UNIT), &token_client.address);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn propose_rejects_amount_exceeding_surplus() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, admin, _) = setup_funded(&env, 10);
    let recipient = Address::generate(&env);
    let to = Address::generate(&env);

    // Lock 8 UNIT so only 2 UNIT surplus remains.
    client.create_package(
        &admin,
        &1,
        &recipient,
        &(8 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 1000),
        &Map::new(&env),
    );

    // Requesting 3 UNIT when only 2 UNIT is free — must fail.
    let res = client.try_propose_surplus_withdrawal(&to, &(3 * UNIT), &token_client.address);
    assert_eq!(res, Err(Ok(Error::InsufficientSurplus)));
}

#[test]
fn propose_rejects_duplicate_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    // First proposal succeeds.
    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);

    // Second proposal while first is still pending must fail.
    let res = client.try_propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    assert_eq!(res, Err(Ok(Error::SurplusWithdrawalPending)));
}

// ---------------------------------------------------------------------------
// propose_surplus_withdrawal — happy path
// ---------------------------------------------------------------------------

#[test]
fn propose_stores_pending_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);
    let now = env.ledger().timestamp();

    client.propose_surplus_withdrawal(&to, &(2 * UNIT), &token_client.address);

    let pending: PendingWithdrawal = client.get_pending_withdrawal().unwrap();
    assert_eq!(pending.to, to);
    assert_eq!(pending.amount, 2 * UNIT);
    assert_eq!(pending.token, token_client.address);
    assert_eq!(pending.executable_at, now + SURPLUS_WITHDRAWAL_DELAY_SECS);
}

#[test]
fn propose_does_not_transfer_funds_immediately() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 3);
    let to = Address::generate(&env);

    let balance_before = token_client.balance(&client.address);
    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    // Balance must be unchanged — no transfer at proposal time.
    assert_eq!(token_client.balance(&client.address), balance_before);
    // Recipient received nothing yet.
    assert_eq!(token_client.balance(&to), 0);
}

// ---------------------------------------------------------------------------
// cancel_surplus_withdrawal
// ---------------------------------------------------------------------------

#[test]
fn cancel_fails_when_no_proposal_pending() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _admin, _) = setup_funded(&env, 5);

    let res = client.try_cancel_surplus_withdrawal();
    assert_eq!(res, Err(Ok(Error::SurplusWithdrawalNotPending)));
}

#[test]
fn cancel_removes_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    assert!(client.get_pending_withdrawal().is_some());

    client.cancel_surplus_withdrawal();
    assert!(client.get_pending_withdrawal().is_none());
}

#[test]
fn cancel_does_not_transfer_any_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    let balance_before = token_client.balance(&client.address);

    client.cancel_surplus_withdrawal();

    assert_eq!(token_client.balance(&client.address), balance_before);
    assert_eq!(token_client.balance(&to), 0);
}

#[test]
fn can_propose_again_after_cancellation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    client.cancel_surplus_withdrawal();

    // Should succeed without error.
    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    assert!(client.get_pending_withdrawal().is_some());
}

// ---------------------------------------------------------------------------
// execute_surplus_withdrawal — timelock enforcement
// ---------------------------------------------------------------------------

#[test]
fn execute_fails_before_delay_elapses() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);

    // Advance time but stay one second before the unlock point.
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS - 1);

    let res = client.try_execute_surplus_withdrawal();
    assert_eq!(res, Err(Ok(Error::SurplusWithdrawalTimelockActive)));
}

#[test]
fn execute_succeeds_exactly_at_delay_boundary() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &(2 * UNIT), &token_client.address);

    // Advance exactly to the unlock second.
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS);

    client.execute_surplus_withdrawal();

    assert_eq!(token_client.balance(&to), 2 * UNIT);
    assert_eq!(token_client.balance(&client.address), 3 * UNIT);
}

#[test]
fn execute_succeeds_after_delay_elapses() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &(3 * UNIT), &token_client.address);

    // Advance well past the unlock point.
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS + 3600);

    client.execute_surplus_withdrawal();

    assert_eq!(token_client.balance(&to), 3 * UNIT);
    assert_eq!(token_client.balance(&client.address), 2 * UNIT);
}

#[test]
fn execute_fails_when_no_proposal_pending() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _, _) = setup_funded(&env, 5);

    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS + 1);
    let res = client.try_execute_surplus_withdrawal();
    assert_eq!(res, Err(Ok(Error::SurplusWithdrawalNotPending)));
}

#[test]
fn execute_removes_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS);
    client.execute_surplus_withdrawal();

    assert!(client.get_pending_withdrawal().is_none());
}

// ---------------------------------------------------------------------------
// execute — surplus re-validation at execution time
// ---------------------------------------------------------------------------

#[test]
fn execute_fails_if_surplus_shrank_below_amount_after_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, admin, _) = setup_funded(&env, 5);
    let recipient = Address::generate(&env);
    let to = Address::generate(&env);

    // 5 UNIT free; propose to withdraw 4 UNIT.
    client.propose_surplus_withdrawal(&to, &(4 * UNIT), &token_client.address);

    // Now lock 3 UNIT — only 2 UNIT surplus remains.
    client.create_package(
        &admin,
        &1,
        &recipient,
        &(3 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 10000),
        &Map::new(&env),
    );

    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS);

    let res = client.try_execute_surplus_withdrawal();
    assert_eq!(res, Err(Ok(Error::InsufficientSurplus)));
}

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

#[test]
fn full_lifecycle_propose_wait_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, admin, _) = setup_funded(&env, 10);
    let recipient = Address::generate(&env);
    let to = Address::generate(&env);

    // Lock 7 UNIT; free surplus = 3 UNIT.
    client.create_package(
        &admin,
        &1,
        &recipient,
        &(7 * UNIT),
        &token_client.address,
        &(env.ledger().timestamp() + 10000),
        &Map::new(&env),
    );

    // Step 1: propose.
    client.propose_surplus_withdrawal(&to, &(3 * UNIT), &token_client.address);
    assert!(client.get_pending_withdrawal().is_some());

    // Step 2: executing too early should fail.
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS - 1);
    assert_eq!(
        client.try_execute_surplus_withdrawal(),
        Err(Ok(Error::SurplusWithdrawalTimelockActive))
    );

    // Step 3: advance to exactly executable_at.
    advance_time(&env, 1);

    // Step 4: execute.
    client.execute_surplus_withdrawal();

    // Funds moved correctly.
    assert_eq!(token_client.balance(&to), 3 * UNIT);
    // Contract still holds the 7 locked UNIT.
    assert_eq!(token_client.balance(&client.address), 7 * UNIT);
    // Proposal cleared.
    assert!(client.get_pending_withdrawal().is_none());
}

#[test]
fn full_lifecycle_propose_cancel_repropose_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to1 = Address::generate(&env);
    let to2 = Address::generate(&env);

    // First proposal to to1.
    client.propose_surplus_withdrawal(&to1, &(2 * UNIT), &token_client.address);

    // Admin changes mind — cancel and re-propose to to2.
    client.cancel_surplus_withdrawal();
    assert!(client.get_pending_withdrawal().is_none());

    client.propose_surplus_withdrawal(&to2, &UNIT, &token_client.address);

    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS);
    client.execute_surplus_withdrawal();

    // Only to2 received funds; to1 got nothing.
    assert_eq!(token_client.balance(&to1), 0);
    assert_eq!(token_client.balance(&to2), UNIT);
}

// ---------------------------------------------------------------------------
// get_pending_withdrawal
// ---------------------------------------------------------------------------

#[test]
fn get_pending_withdrawal_returns_none_initially() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _, _) = setup_funded(&env, 5);
    assert_eq!(client.get_pending_withdrawal(), None);
}

#[test]
fn get_pending_withdrawal_returns_proposal_fields() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);
    let now = env.ledger().timestamp();

    client.propose_surplus_withdrawal(&to, &(2 * UNIT), &token_client.address);

    let p = client.get_pending_withdrawal().expect("should have proposal");
    assert_eq!(p.to, to);
    assert_eq!(p.amount, 2 * UNIT);
    assert_eq!(p.token, token_client.address);
    assert_eq!(p.executable_at, now + SURPLUS_WITHDRAWAL_DELAY_SECS);
}

// ---------------------------------------------------------------------------
// Pause controls interact with propose/execute
// ---------------------------------------------------------------------------

#[test]
fn propose_blocked_when_withdraw_action_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    client.pause_action(&symbol_short!("withdraw"));

    let res = client.try_propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    assert_eq!(res, Err(Ok(Error::ContractPaused)));
}

#[test]
fn execute_blocked_when_withdraw_action_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_client, _admin, _) = setup_funded(&env, 5);
    let to = Address::generate(&env);

    // Propose first, then pause.
    client.propose_surplus_withdrawal(&to, &UNIT, &token_client.address);
    advance_time(&env, SURPLUS_WITHDRAWAL_DELAY_SECS);

    client.pause_action(&symbol_short!("withdraw"));

    let res = client.try_execute_surplus_withdrawal();
    assert_eq!(res, Err(Ok(Error::ContractPaused)));
}

// ---------------------------------------------------------------------------
// Boundary: delay constant sanity check
// ---------------------------------------------------------------------------

#[test]
fn delay_constant_is_24_hours() {
    assert_eq!(SURPLUS_WITHDRAWAL_DELAY_SECS, 86_400);
}
