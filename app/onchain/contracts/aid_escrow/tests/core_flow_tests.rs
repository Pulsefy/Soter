#![cfg(test)]

use aid_escrow::{AidEscrow, AidEscrowClient, Error, PackageStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

// Standard Stellar Asset decimals is 7.
// Our contract requires whole token amounts (multiples of 10^7).
const UNIT: i128 = 10_000_000;

fn setup_token(env: &Env, admin: &Address) -> (TokenClient<'static>, StellarAssetClient<'static>) {
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());
    (token_client, token_admin_client)
}

#[test]
fn test_core_flow_fund_create_claim() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);

    // Initialize
    client.init(&admin);

    // Mint 10.0 tokens to admin for funding
    token_admin_client.mint(&admin, &(10 * UNIT));

    // 2. Fund the contract (Pool) with 5.0 tokens
    client.fund(&token_client.address, &admin, &(5 * UNIT));
    assert_eq!(token_client.balance(&contract_id), 5 * UNIT);

    // 3. Create Package for 1.0 token
    let pkg_id = 101;
    let expiry = env.ledger().timestamp() + 86400; // 1 day later
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

    // Check Package State
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Created);
    assert_eq!(pkg.amount, UNIT);

    // 4. Claim
    client.claim(&pkg_id);

    // Check Final State
    let pkg_claimed = client.get_package(&pkg_id);
    assert_eq!(pkg_claimed.status, PackageStatus::Claimed);
    assert_eq!(token_client.balance(&recipient), UNIT);
    assert_eq!(token_client.balance(&contract_id), 4 * UNIT); // 5.0 - 1.0
}

#[test]
fn test_solvency_check() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    // Fund with exactly 1.0 token
    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    // Try creating package > available balance (2.0 tokens)
    let metadata = Map::new(&env);
    let res = client.try_create_package(
        &admin,
        &1,
        &recipient,
        &(2 * UNIT),
        &token_client.address,
        &0,
        &metadata,
    );
    assert_eq!(res, Err(Ok(Error::InsufficientFunds)));

    // Create valid package using all funds (1.0 token)
    client.create_package(
        &admin,
        &2,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );

    // Try creating another package (funds are locked)
    let res2 = client.try_create_package(
        &admin,
        &3,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );
    assert_eq!(res2, Err(Ok(Error::InsufficientFunds)));
}

#[test]
fn test_expiry_and_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_client, token_admin_client) = setup_token(&env, &token_admin);

    let contract_id = env.register(AidEscrow, ());
    let client = AidEscrowClient::new(&env, &contract_id);
    client.init(&admin);

    token_admin_client.mint(&admin, &UNIT);
    client.fund(&token_client.address, &admin, &UNIT);

    // Create Package that expires soon
    let start_time = 1000;
    env.ledger().set_timestamp(start_time);
    let pkg_id = 1;
    let expiry = start_time + 100;
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

    // Advance time past expiry
    env.ledger().set_timestamp(expiry + 1);

    // Recipient tries to claim -> Should Fail (Auto-expires)
    let claim_res = client.try_claim(&pkg_id);
    assert_eq!(claim_res, Err(Ok(Error::PackageExpired)));

    // Admin refunds
    assert_eq!(token_client.balance(&admin), 0);
    client.refund(&pkg_id);

    // Balance after refund: Admin gets 1.0 back
    assert_eq!(token_client.balance(&admin), UNIT);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Refunded);
}

#[test]
fn test_cancel_package_flow() {
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

    let pkg_id = 1;
    let metadata = Map::new(&env);
    client.create_package(
        &admin,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );

    // Cancel
    client.cancel_package(&pkg_id);

    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Cancelled);

    // Funds are now unlocked. We can create a new package using those same funds.
    let pkg_id_2 = 2;
    client.create_package(
        &admin,
        &pkg_id_2,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );
}

#[test]
fn test_distributor_package_creation() {
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

    let pkg_id = 1;
    let metadata = Map::new(&env);
    client.create_package(
        &distributor,
        &pkg_id,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );
    let pkg = client.get_package(&pkg_id);
    assert_eq!(pkg.status, PackageStatus::Created);

    client.remove_distributor(&distributor);
    let res = client.try_create_package(
        &distributor,
        &2,
        &recipient,
        &UNIT,
        &token_client.address,
        &0,
        &metadata,
    );
    assert_eq!(res, Err(Ok(Error::NotAuthorized)));
}
