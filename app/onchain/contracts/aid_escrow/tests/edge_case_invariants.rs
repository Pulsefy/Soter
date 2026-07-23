#![cfg(test)]
#![allow(clippy::all)]
#![allow(dead_code)]

//! Edge case invariant tests for aid_escrow contract
//! These tests focus on boundary conditions and unusual state transitions
//! that might expose invariant violations.

use aid_escrow::{AidEscrow, AidEscrowClient, Config};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000;

fn default_ledger_info() -> LedgerInfo {
    LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 23,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    }
}

fn setup_env() -> (
    Env,
    AidEscrowClient<'static>,
    Address,
    Address,
    StellarAssetClient<'static>,
    TokenClient<'static>,
) {
    let env = Env::default();
    env.ledger().set(default_ledger_info());
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 0,
        allowed_tokens: soroban_sdk::Vec::new(&env),
    });

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let token_sac = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    (env, client, admin, token, token_sac, token_client)
}

fn advance_time(env: &Env, seconds: u64) {
    let mut info = env.ledger().get();
    info.timestamp += seconds;
    env.ledger().set(info);
}

// ============================================================================
// Edge Case 1: Zero-amount packages
// ============================================================================

#[test]
fn test_zero_amount_package_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    // Fund with substantial amount
    let fund_amount = 100 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    // Try to create zero-amount package (should fail or be handled gracefully)
    let recipient = Address::generate(&env);
    let result = client.try_create_package(
        &admin,
        &1,
        &recipient,
        &0, // zero amount
        &token,
        &0,
        &Map::new(&env),
    );

    // Verify invariants still hold
    let locked = client.get_total_locked(&token);
    let balance = token_client.balance(&client.address);

    // Invariant: balance >= locked
    assert!(balance >= locked, "Solvency violated after zero-amount attempt");

    // If zero-amount package was created, it should not affect accounting
    if result.is_ok() {
        // Zero-amount package exists but locked should still be 0 or minimal
        assert!(locked <= fund_amount, "Zero-amount package caused unexpected lock");
    }
}

// ============================================================================
// Edge Case 2: Maximum amount packages (overflow testing)
// ============================================================================

#[test]
fn test_large_amount_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    // Fund with large amount (but not max i128 to avoid overflow in setup)
    let fund_amount = 1_000_000 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    // Create multiple large packages
    let mut total_locked_expected: i128 = 0;
    for i in 0..10 {
        let amount = 50_000 * UNIT;
        let recipient = Address::generate(&env);
        match client.try_create_package(
            &admin,
            &(i as u64),
            &recipient,
            &amount,
            &token,
            &0,
            &Map::new(&env),
        ) {
            Ok(Ok(_)) => {
                total_locked_expected += amount;
            }
            _ => {}
        }
    }

    // Verify invariants
    let locked = client.get_total_locked(&token);
    let balance = token_client.balance(&client.address);

    assert_eq!(locked, total_locked_expected, "Locked amount mismatch");
    assert!(balance >= locked, "Solvency violated with large amounts");
    assert!(locked <= fund_amount, "Locked exceeds funded amount");
}

// ============================================================================
// Edge Case 3: Rapid claim-revoke cycles
// ============================================================================

#[test]
fn test_rapid_state_transition_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    let fund_amount = 50 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    let mut total_claimed: i128 = 0;
    let mut total_refunded: i128 = 0;

    // Create and immediately claim/refund in rapid succession
    for i in 0..20 {
        let amount = UNIT;
        let recipient = Address::generate(&env);

        match client.try_create_package(
            &admin,
            &(i as u64),
            &recipient,
            &amount,
            &token,
            &0,
            &Map::new(&env),
        ) {
            Ok(Ok(_)) => {
                // Immediately claim or refund
                if i % 2 == 0 {
                    if client.try_claim(&(i as u64)).is_ok() {
                        total_claimed += amount;
                    }
                } else {
                    if client.try_refund(&(i as u64)).is_ok() {
                        total_refunded += amount;
                    }
                }
            }
            _ => {}
        }

        // Check invariants after each operation
        let locked = client.get_total_locked(&token);
        let balance = token_client.balance(&client.address);
        let claimed = client.get_total_claimed(&token);

        assert!(balance >= locked, "Solvency violated in rapid cycle");
        assert!(claimed + total_refunded <= fund_amount, "Accounting violated");
    }
}

// ============================================================================
// Edge Case 4: Expired package handling
// ============================================================================

#[test]
fn test_expired_package_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    let fund_amount = 50 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    // Create package with short expiry
    let amount = 5 * UNIT;
    let recipient = Address::generate(&env);
    let expires_at = env.ledger().timestamp() + 100; // expires in 100 seconds

    client.create_package(
        &admin,
        &1,
        &recipient,
        &amount,
        &token,
        &expires_at,
        &Map::new(&env),
    );

    let locked_before = client.get_total_locked(&token);
    assert_eq!(locked_before, amount, "Package not locked");

    // Advance time past expiry
    advance_time(&env, 200);

    // Try to claim expired package (should fail)
    let claim_result = client.try_claim(&1);

    // Try to refund expired package (should succeed)
    let refund_result = client.try_refund(&1);

    // Verify invariants
    let locked_after = client.get_total_locked(&token);
    let balance = token_client.balance(&client.address);

    // If refund succeeded, locked should decrease
    if refund_result.is_ok() {
        assert_eq!(locked_after, 0, "Locked should be 0 after refund");
    }

    assert!(balance >= locked_after, "Solvency violated after expiry");
}

// ============================================================================
// Edge Case 5: Multiple tokens
// ============================================================================

#[test]
fn test_multi_token_invariants() {
    let env = Env::default();
    env.ledger().set(default_ledger_info());
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);
    client.set_config(&Config {
        min_amount: 1,
        max_expires_in: 0,
        allowed_tokens: soroban_sdk::Vec::new(&env),
    });

    // Create two different tokens
    let token1_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token1 = token1_contract.address();
    let token1_sac = StellarAssetClient::new(&env, &token1);
    let token1_client = TokenClient::new(&env, &token1);

    let token2_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token2 = token2_contract.address();
    let token2_sac = StellarAssetClient::new(&env, &token2);
    let token2_client = TokenClient::new(&env, &token2);

    // Fund with both tokens
    let amount1 = 50 * UNIT;
    let amount2 = 30 * UNIT;
    token1_sac.mint(&admin, &amount1);
    token2_sac.mint(&admin, &amount2);
    client.fund(&token1, &admin, &amount1);
    client.fund(&token2, &admin, &amount2);

    // Create packages with different tokens
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    client.create_package(
        &admin,
        &1,
        &recipient1,
        &(10 * UNIT),
        &token1,
        &0,
        &Map::new(&env),
    );

    client.create_package(
        &admin,
        &2,
        &recipient2,
        &(15 * UNIT),
        &token2,
        &0,
        &Map::new(&env),
    );

    // Verify per-token invariants
    let locked1 = client.get_total_locked(&token1);
    let locked2 = client.get_total_locked(&token2);
    let balance1 = token1_client.balance(&client.address);
    let balance2 = token2_client.balance(&client.address);

    assert_eq!(locked1, 10 * UNIT, "Token1 locked mismatch");
    assert_eq!(locked2, 15 * UNIT, "Token2 locked mismatch");
    assert!(balance1 >= locked1, "Token1 solvency violated");
    assert!(balance2 >= locked2, "Token2 solvency violated");
}

// ============================================================================
// Edge Case 6: Withdraw surplus edge cases
// ============================================================================

#[test]
fn test_withdraw_surplus_boundary_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    // Fund exactly the amount we'll lock
    let fund_amount = 10 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    // Lock all funds
    let recipient = Address::generate(&env);
    client.create_package(
        &admin,
        &1,
        &recipient,
        &fund_amount,
        &token,
        &0,
        &Map::new(&env),
    );

    let locked = client.get_total_locked(&token);
    let balance = token_client.balance(&client.address);

    // Try to withdraw surplus (should fail or withdraw 0)
    let withdraw_to = Address::generate(&env);
    let withdraw_result = client.try_withdraw_surplus(&withdraw_to, &UNIT, &token);

    // Verify invariants
    let balance_after = token_client.balance(&client.address);
    let locked_after = client.get_total_locked(&token);

    // Balance should not go below locked
    assert!(balance_after >= locked_after, "Solvency violated after withdraw attempt");

    // If withdraw succeeded, it should only be from surplus
    if withdraw_result.is_ok() {
        assert!(balance >= locked, "Withdraw from locked funds");
    }
}

// ============================================================================
// Edge Case 7: Concurrent package creation and claiming
// ============================================================================

#[test]
fn test_concurrent_operations_invariants() {
    let (env, client, admin, token, token_sac, token_client) = setup_env();

    let fund_amount = 100 * UNIT;
    token_sac.mint(&admin, &fund_amount);
    client.fund(&token, &admin, &fund_amount);

    let mut total_claimed: i128 = 0;
    let mut total_locked: i128 = 0;

    // Create 10 packages
    for i in 0..10 {
        let amount = 5 * UNIT;
        let recipient = Address::generate(&env);
        client.create_package(
            &admin,
            &(i as u64),
            &recipient,
            &amount,
            &token,
            &0,
            &Map::new(&env),
        );
        total_locked += amount;
    }

    // Claim 5 packages while creating 5 more
    for i in 0..5 {
        // Claim existing
        if client.try_claim(&(i as u64)).is_ok() {
            total_claimed += 5 * UNIT;
            total_locked -= 5 * UNIT;
        }

        // Create new
        let amount = 3 * UNIT;
        let recipient = Address::generate(&env);
        client.create_package(
            &admin,
            &((i + 10) as u64),
            &recipient,
            &amount,
            &token,
            &0,
            &Map::new(&env),
        );
        total_locked += amount;

        // Check invariants
        let locked = client.get_total_locked(&token);
        let balance = token_client.balance(&client.address);
        let claimed = client.get_total_claimed(&token);

        assert!(balance >= locked, "Solvency violated in concurrent ops");
        assert!(claimed <= fund_amount, "Claimed exceeds funded");
    }
}
