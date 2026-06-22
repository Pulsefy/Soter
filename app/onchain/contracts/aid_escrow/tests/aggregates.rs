#![cfg(test)]

use aid_escrow::{Aggregates, AidEscrow, AidEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

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
    // Mint 2x the fund amount to ensure the admin has enough balance
    token_admin_client.mint(&admin, &(fund_amount * 2));
    client.fund(&token_client.address, &admin, &fund_amount);

    (client, token_client, admin, contract_id)
}

#[test]
fn test_aggregates_no_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, _admin, _contract_id) = setup_funded(&env, 10_000_000);

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

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 50_000_000);
    let recipient = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &1,
        &recipient,
        &20_000_000, // Multiple of 10^7
        &token_client.address,
        &expiry,
        &metadata,
    );

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 20_000_000);
    assert_eq!(agg.total_claimed, 0);
    assert_eq!(agg.total_expired_cancelled, 0);
}

#[test]
fn test_aggregates_mixed_statuses() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 100_000_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    let r4 = Address::generate(&env);

    let start_time = 1000u64;
    env.ledger().set_timestamp(start_time);
    let expiry = start_time + 86400;
    let short_expiry = start_time + 100;

    let metadata = Map::new(&env);

    // P1: Created (10M)
    client.create_package(
        &admin,
        &1,
        &r1,
        &10_000_000,
        &token_client.address,
        &expiry,
        &metadata,
    );

    // P2: Claimed (20M)
    client.create_package(
        &admin,
        &2,
        &r2,
        &20_000_000,
        &token_client.address,
        &expiry,
        &metadata,
    );
    client.claim(&2);

    // P3: Cancelled (10M)
    client.create_package(
        &admin,
        &3,
        &r3,
        &10_000_000,
        &token_client.address,
        &expiry,
        &metadata,
    );
    client.revoke(&3);

    // P4: Refunded (10M)
    client.create_package(
        &admin,
        &4,
        &r4,
        &10_000_000,
        &token_client.address,
        &short_expiry,
        &metadata,
    );
    env.ledger().set_timestamp(short_expiry + 1);
    client.refund(&4);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 10_000_000);
    assert_eq!(agg.total_claimed, 20_000_000);
    assert_eq!(agg.total_expired_cancelled, 20_000_000); // 10M (P3) + 10M (P4)
}

#[test]
fn test_aggregates_all_claimed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 100_000_000);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &10,
        &r1,
        &30_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );
    client.create_package(
        &admin,
        &11,
        &r2,
        &40_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );

    client.claim(&10);
    client.claim(&11);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 70_000_000);
}

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

    token_admin_a_client.mint(&admin, &100_000_000);
    token_admin_b_client.mint(&admin, &100_000_000);
    client.fund(&token_a.address, &admin, &50_000_000);
    client.fund(&token_b.address, &admin, &50_000_000);

    let r1 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    // Token A: 30M committed, 20M claimed
    client.create_package(
        &admin,
        &1,
        &r1,
        &30_000_000,
        &token_a.address,
        &expiry,
        &Map::new(&env),
    );
    client.create_package(
        &admin,
        &2,
        &r1,
        &20_000_000,
        &token_a.address,
        &expiry,
        &Map::new(&env),
    );
    client.claim(&2);

    // Token B: 50M cancelled
    client.create_package(
        &admin,
        &3,
        &r1,
        &50_000_000,
        &token_b.address,
        &expiry,
        &Map::new(&env),
    );
    client.revoke(&3);

    let agg_a = client.get_aggregates(&token_a.address);
    assert_eq!(agg_a.total_committed, 30_000_000);
    assert_eq!(agg_a.total_claimed, 20_000_000);

    let agg_b = client.get_aggregates(&token_b.address);
    assert_eq!(agg_b.total_expired_cancelled, 50_000_000);
}

#[test]
fn test_aggregates_disburse_counts_as_claimed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 50_000_000);
    let r1 = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1,
        &r1,
        &10_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );
    client.claim(&1);

    client.create_package(
        &admin,
        &2,
        &r1,
        &20_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );
    client.disburse(&2);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_claimed, 30_000_000);
}

#[test]
fn test_aggregates_many_packages() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 200_000_000);
    let expiry = env.ledger().timestamp() + 86400;

    for i in 0u64..10 {
        let r = Address::generate(&env);
        client.create_package(
            &admin,
            &i,
            &r,
            &10_000_000,
            &token_client.address,
            &expiry,
            &Map::new(&env),
        );
        if i % 2 == 0 {
            client.claim(&i);
        } else {
            client.cancel_package(&i);
        }
    }

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_claimed, 50_000_000);
    assert_eq!(agg.total_expired_cancelled, 50_000_000);
}

#[test]
fn test_aggregates_update_after_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 50_000_000);
    let r = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1,
        &r,
        &30_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );
    assert_eq!(
        client.get_aggregates(&token_client.address).total_committed,
        30_000_000
    );

    client.claim(&1);
    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_committed, 0);
    assert_eq!(agg.total_claimed, 30_000_000);
}

#[test]
fn test_aggregates_revoke_then_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 50_000_000);
    let r = Address::generate(&env);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1,
        &r,
        &40_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );
    client.revoke(&1);
    client.refund(&1);

    let agg = client.get_aggregates(&token_client.address);
    assert_eq!(agg.total_expired_cancelled, 40_000_000);
    assert_eq!(agg.total_claimed, 0);
}

#[test]
fn test_aggregates_unknown_token() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_client, admin, _contract_id) = setup_funded(&env, 20_000_000);
    let expiry = env.ledger().timestamp() + 86400;

    client.create_package(
        &admin,
        &1,
        &Address::generate(&env),
        &10_000_000,
        &token_client.address,
        &expiry,
        &Map::new(&env),
    );

    let unknown_token = Address::generate(&env);
    let agg = client.get_aggregates(&unknown_token);
    assert_eq!(agg.total_committed, 0);
}
