#![cfg(test)]

//! Upgrade / migration test harness.
//!
//! `versioning.rs` only asserts that the stored version counter moves. These
//! tests walk a real version progression (v1 -> v2 -> v3) and assert that
//! contract STATE stays compatible across each step: escrow balances, package
//! records, and role configuration must all survive `migrate()`. Every
//! assertion carries a message so a broken migration reports what it broke.

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

const UNIT: i128 = 10_000_000; // 1.0 token (7 decimals)

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

#[test]
fn test_state_survives_single_version_step() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &(5 * UNIT));
    client.fund(&token_client.address, &admin, &(5 * UNIT));

    let pkg_id = 1;
    let expiry = env.ledger().timestamp() + 86400;
    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &expiry,
        &metadata,
    );

    assert_eq!(client.get_version(), 1, "init must record version 1");

    client.migrate(&2);
    assert_eq!(
        client.get_version(),
        2,
        "migrate must record the new version"
    );

    let pkg = client.get_package(&pkg_id);
    assert_eq!(
        pkg.status,
        PackageStatus::Created,
        "package status must survive the v1 -> v2 migration"
    );
    assert_eq!(
        pkg.amount, UNIT,
        "package amount must survive the v1 -> v2 migration"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        5 * UNIT,
        "escrow balance must survive the v1 -> v2 migration"
    );

    // A package created before the migration must still be claimable after it.
    client.claim(&pkg_id);
    assert_eq!(
        client.view_package_status(&pkg_id),
        PackageStatus::Claimed,
        "pre-migration package must remain claimable after migration"
    );
    assert_eq!(
        token_client.balance(&recipient),
        UNIT,
        "claim payout must be unaffected by the migration"
    );
}

#[test]
fn test_multi_step_progression_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &(4 * UNIT));
    client.fund(&token_client.address, &admin, &(4 * UNIT));

    let expiry = env.ledger().timestamp() + 86400;
    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &1,
        &recipient,
        &UNIT,
        &token_client.address,
        &expiry,
        &metadata,
    );
    client.create_package(
        &admin,
        &2,
        &recipient,
        &(2 * UNIT),
        &token_client.address,
        &expiry,
        &metadata,
    );

    // Step v1 -> v2.
    client.migrate(&2);
    assert_eq!(
        client.get_version(),
        2,
        "first migration step must land on v2"
    );
    assert_eq!(
        client.get_package(&1).amount,
        UNIT,
        "first package amount must be intact at v2"
    );
    assert_eq!(
        client.get_package(&2).amount,
        2 * UNIT,
        "second package amount must be intact at v2"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        4 * UNIT,
        "escrow balance must be intact at v2"
    );

    // Step v2 -> v3.
    client.migrate(&3);
    assert_eq!(
        client.get_version(),
        3,
        "second migration step must land on v3"
    );
    assert_eq!(
        client.view_package_status(&1),
        PackageStatus::Created,
        "first package status must be intact at v3"
    );
    assert_eq!(
        client.view_package_status(&2),
        PackageStatus::Created,
        "second package status must be intact at v3"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        4 * UNIT,
        "escrow balance must be intact at v3"
    );

    // Claims must still settle correctly after the full progression.
    client.claim(&1);
    client.claim(&2);
    assert_eq!(
        token_client.balance(&recipient),
        3 * UNIT,
        "claims after a multi-step migration must pay out the original amounts"
    );
}

#[test]
fn test_role_config_survives_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let distributor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &(2 * UNIT));
    client.fund(&token_client.address, &admin, &(2 * UNIT));
    client.add_distributor(&distributor);

    client.migrate(&2);

    let expiry = env.ledger().timestamp() + 86400;
    let metadata = Map::new(&env);
    client.create_package(
        &distributor,
        &1,
        &recipient,
        &UNIT,
        &token_client.address,
        &expiry,
        &metadata,
    );
    assert_eq!(
        client.view_package_status(&1),
        PackageStatus::Created,
        "distributor role granted before migration must still be honoured after it"
    );

    // Revocation must still work post-migration.
    client.remove_distributor(&distributor);
    let res = client.try_create_package(
        &distributor,
        &2,
        &recipient,
        &UNIT,
        &token_client.address,
        &expiry,
        &metadata,
    );
    assert_eq!(
        res,
        Err(Ok(Error::NotAuthorized)),
        "revoked distributor must be rejected after migration"
    );
}

#[test]
fn test_version_never_regresses_on_repeat_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &Address::generate(&env));

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    let expiry = env.ledger().timestamp() + 86400;
    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &1,
        &recipient,
        &UNIT,
        &token_client.address,
        &expiry,
        &metadata,
    );

    client.migrate(&2);
    let before = client.get_version();

    // Re-running the same migration step must never move the contract
    // backwards or damage stored state, whatever the transition policy is.
    let _ = client.try_migrate(&before);
    let after = client.get_version();
    assert!(
        after >= before,
        "repeating a migration step must not regress the stored version"
    );
    assert_eq!(
        client.get_package(&1).amount,
        UNIT,
        "repeating a migration step must not damage package state"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        UNIT,
        "repeating a migration step must not damage escrow balances"
    );
}
