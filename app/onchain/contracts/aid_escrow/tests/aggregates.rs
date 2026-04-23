#![cfg(test)]

use aid_escrow::{Aggregates, AidEscrow, AidEscrowClient};
use soroban_sdk::{
    Address, Env,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

/// Helper: set up contract, token, fund, and return the client + token client.
fn setup_funded(
    env: &Env,
    fund_amount: i128,
) -> (
    AidEscrowClient<'static>,
    TokenClient<'static>,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let (token_client, token_admin_client) = setup_token(env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(env, &contract_id);

    client.init(&admin);
    token_admin_client.mint(&admin, &(fund_amount * 2));
    client.fund(&token_client.address, &admin, &fund_amount);

    (client, token_client, admin, contract_id)
}

// ---------- Basic aggregates ----------

#[test]
fn test_aggregates_no_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, _admin, _contract_id) = setup_funded(&env, 10_000);

    // No packages created yet — all aggregates should be zero
    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(
        agg,
        Aggregates {
            total_committed: 0,
            total_claimed: 0,
            total_expired_cancelled: 0,
        }
    );
}

#[test]
fn test_aggregates_single_created_package() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);
    let recipient = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1,
        &recipient,
        &2000,
        &token_client.address,
        &expiry,
    );

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 2000);
    assert_eq!(agg.total_claimed, 0);
    assert_eq!(agg.total_expired_cancelled, 0);
}

// ---------- Multiple packages across different statuses ----------

#[test]
fn test_aggregates_mixed_statuses() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let r4 = Address::generate(&env);

    let start_time = 1000u64;
    env.ledger().set_timestamp(start_time);
    let expiry = start_time + 86400;
    let short_expiry = start_time + 100;

    // Package 1 — will remain Created (committed)
    client.create_package(&admin, &1, &r1, &1000, &token_client.address, &expiry);

    // Package 2 — will be Claimed
    client.create_package(&admin, &2, &r2, &2000, &token_client.address, &expiry);
    client.claim(&2);

    // Package 3 — will be Cancelled (via revoke)
    client.create_package(&admin, &3, &r3, &500, &token_client.address, &expiry);
    client.revoke(&3);

    // Package 4 — will be Expired then Refunded
    client.create_package(&admin, &4, &r4, &750, &token_client.address, &short_expiry);
    // Advance past short_expiry to expire
    env.ledger().set_timestamp(short_expiry + 1);
    client.refund(&4);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 1000); // pkg 1 (Created)
    assert_eq!(agg.total_claimed, 2000); // pkg 2 (Claimed)
    assert_eq!(agg.total_expired_cancelled, 1250); // pkg 3 (500 Cancelled) + pkg 4 (750 Refunded)
}

#[test]
fn test_aggregates_all_claimed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &10, &r1, &3000, &token_client.address, &expiry);
    client.create_package(&admin, &11, &r2, &4000, &token_client.address, &expiry);
    client.claim(&10);
    client.claim(&11);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 7000);
    assert_eq!(agg.total_expired_cancelled, 0);
}

#[test]
fn test_aggregates_all_cancelled() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &20, &r1, &1500, &token_client.address, &expiry);
    client.create_package(&admin, &21, &r2, &2500, &token_client.address, &expiry);
    client.cancel_package(&20);
    client.cancel_package(&21);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 0);
    assert_eq!(agg.total_expired_cancelled, 4000);
}

// ---------- Token filtering ----------

#[test]
fn test_aggregates_filters_by_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin_a = Address::generate(&env);
    let token_admin_b = Address::generate(&env);
    let (token_a, token_admin_a_client) = setup_token(&env, &token_admin_a);
    let (token_b, token_admin_b_client) = setup_token(&env, &token_admin_b);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // Fund with both tokens
    token_admin_a_client.mint(&admin, &20_000);
    token_admin_b_client.mint(&admin, &20_000);
    client.fund(&token_a.address, &admin, &10_000);
    client.fund(&token_b.address, &admin, &10_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    // Token A packages
    client.create_package(&admin, &1, &r1, &3000, &token_a.address, &expiry);
    client.create_package(&admin, &2, &r2, &2000, &token_a.address, &expiry);
    client.claim(&2);

    // Token B packages
    client.create_package(&admin, &3, &r1, &5000, &token_b.address, &expiry);
    client.revoke(&3);

    // Aggregates for Token A
    let agg_a = client.get_aggregates(&token_a.address);
    assert_eq!(agg_a.total_committed, 3000);
    assert_eq!(agg_a.total_claimed, 2000);
    assert_eq!(agg_a.total_expired_cancelled, 0);

    // Aggregates for Token B
    let agg_b = client.get_aggregates(&token_b.address);
    assert_eq!(agg_b.total_committed, 0);
    assert_eq!(agg_b.total_claimed, 0);
    assert_eq!(agg_b.total_expired_cancelled, 5000);
}

// ---------- Edge: unknown token returns zeros ----------

#[test]
fn test_aggregates_unknown_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &1, &r, &1000, &token_client.address, &expiry);

    // Query for a completely different (random) token address
    let unknown_token = Address::generate(&env);
    let agg = client.get_aggregates(&unknown_token);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 0);
    assert_eq!(agg.total_expired_cancelled, 0);
}

// ---------- Disbursed counts as Claimed ----------

#[test]
fn test_aggregates_disburse_counts_as_claimed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    // Package 1 — claimed by recipient
    client.create_package(&admin, &1, &r1, &1000, &token_client.address, &expiry);
    client.claim(&1);

    // Package 2 — disbursed by admin (also sets status to Claimed)
    client.create_package(&admin, &2, &r2, &2000, &token_client.address, &expiry);
    client.disburse(&2);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 3000); // both claim and disburse
    assert_eq!(agg.total_expired_cancelled, 0);
}

// ---------- Large-scale: many packages ----------

#[test]
fn test_aggregates_many_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 100_000);
    let expiry = env.ledger().timestamp() + 86400;

    // Create 10 packages: even IDs -> claim, odd IDs -> cancel
    for i in 0u64..10 {
        let r = Address::generate(&env);
        client.create_package(&admin, &i, &r, &1000, &token_client.address, &expiry);
        if i % 2 == 0 {
            client.claim(&i);
        } else {
            client.cancel_package(&i);
        }
    }

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0); // none left in Created
    assert_eq!(agg.total_claimed, 5000); // 5 claimed × 1000
    assert_eq!(agg.total_expired_cancelled, 5000); // 5 cancelled × 1000
}

// ---------- Aggregates update correctly after status transitions ----------

#[test]
fn test_aggregates_update_after_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    // Step 1: Create — should be committed
    client.create_package(&admin, &1, &r, &3000, &token_client.address, &expiry);
    let agg1 = client.get_aggregates(&token_client.address);
    assert_eq!(agg1.total_committed, 3000);
    assert_eq!(agg1.total_claimed, 0);
    assert_eq!(agg1.total_expired_cancelled, 0);

    // Step 2: Claim — moves from committed to claimed
    client.claim(&1);
    let agg2 = client.get_aggregates(&token_client.address);
    assert_eq!(agg2.total_committed, 0);
    assert_eq!(agg2.total_claimed, 3000);
    assert_eq!(agg2.total_expired_cancelled, 0);
}

#[test]
fn test_aggregates_revoke_then_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 10_000);

    let r = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(&admin, &1, &r, &4000, &token_client.address, &expiry);

    // After creation
    let agg1 = client.get_aggregates(&token_client.address);
    assert_eq!(agg1.total_committed, 4000);

    // After revoke (Cancelled)
    client.revoke(&1);
    let agg2 = client.get_aggregates(&token_client.address);
    assert_eq!(agg2.total_committed, 0);
    assert_eq!(agg2.total_expired_cancelled, 4000);

    // After refund (Refunded — still in expired/cancelled bucket)
    client.refund(&1);
    let agg3 = client.get_aggregates(&token_client.address);
    assert_eq!(agg3.total_committed, 0);
    assert_eq!(agg3.total_claimed, 0);
    assert_eq!(agg3.total_expired_cancelled, 4000);
}
